import { type AdminTag, type Locale, tagInputSchema, type TagInput, type TagTranslations, tagTranslationLocales } from "@blog/shared";
import { normalizeSlug, toApiIssues } from "./post-form";

/*
 * 标签的纯逻辑：管理页的表单校验、编辑器里的候选列表。不依赖 React，单元测试直接跑。
 */

export type TagFormValues = { name: string; slug: string; translations: TagTranslations };
export type TagFormErrors = { name?: string; slug?: string; translations?: Partial<Record<Locale, string>> };

/** 表单的初始值：新建时全空；编辑时取标签现有的值（旧标签缺的译名是空的，等作者填） */
export function tagFormValues(tag?: AdminTag): TagFormValues {
  const translations: TagTranslations = Object.fromEntries(tagTranslationLocales.map((locale) => [locale, tag?.translations[locale] ?? ""]));
  return { name: tag?.name ?? "", slug: tag?.slug ?? "", translations };
}

/** 名称比较不分大小写（和数据库的唯一索引 lower(name) 一致），首尾空白不算 */
const nameKey = (name: string) => name.trim().toLowerCase();

/** toApiIssues 按字段名（这里是语言代码）拼出的说明换成"译名" */
function translationMessage(message: string): string {
  if (message.startsWith("请填写")) return "请填写译名";
  const tooLong = /不能超过 (\d+) 个字符/.exec(message);
  return tooLong ? `译名不能超过 ${tooLong[1]} 个字符` : message;
}

export function hasTagFormErrors(errors: TagFormErrors): boolean {
  return Boolean(errors.name || errors.slug || Object.values(errors.translations ?? {}).some(Boolean));
}

/**
 * 管理页新建 / 编辑标签前的校验：先用 shared 的 schema（每种语言的译名必填），再查和已有标签重名。
 * 查重只是提前给出更具体的提示；真正的保证是数据库的唯一约束（并发时服务端返回 409）。
 * slug 留空时用名称自动生成（只对拉丁字母有效，中文名需要手填）。
 */
export function validateTagForm(values: TagFormValues, existing: AdminTag[], editingId?: number): { data?: TagInput; errors: TagFormErrors } {
  const slug = normalizeSlug(values.slug || values.name);
  // 只取需要译名的语言（表单里不会有别的，防御一下）
  const translations: TagTranslations = Object.fromEntries(tagTranslationLocales.map((locale) => [locale, values.translations[locale] ?? ""]));
  const errors: TagFormErrors = {};
  const setTranslationError = (locale: Locale, message: string) => {
    errors.translations ??= {};
    errors.translations[locale] ??= message;
  };

  const parsed = tagInputSchema.safeParse({ name: values.name, slug, translations });
  if (!parsed.success) {
    for (const issue of toApiIssues(parsed.error.issues)) {
      const [field, locale] = issue.path.split(".");
      if (field === "translations" && locale) setTranslationError(locale as Locale, translationMessage(issue.message));
      else if (field === "slug") errors.slug ??= issue.message;
      else errors.name ??= issue.message;
    }
  }
  if (values.name.trim() && !slug) errors.slug = "中文名称无法自动生成 slug，请手动填写（如 frontend）";
  if (!parsed.success || hasTagFormErrors(errors)) return { errors };

  const data = parsed.data;
  const others = existing.filter((tag) => tag.id !== editingId);
  const sameName = others.find((tag) => nameKey(tag.name) === nameKey(data.name));
  if (sameName) errors.name = `已经有标签「${sameName.name}」了`;
  const sameSlug = others.find((tag) => tag.slug === data.slug);
  if (sameSlug) errors.slug = `slug "${sameSlug.slug}" 已被「${sameSlug.name}」使用`;
  for (const locale of tagTranslationLocales) {
    const translated = data.translations[locale] ?? "";
    const clash = others.find((tag) => tag.translations[locale] !== undefined && nameKey(tag.translations[locale]) === nameKey(translated));
    if (clash) setTranslationError(locale, `「${clash.name}」在这种语言里也叫「${clash.translations[locale] ?? ""}」`);
  }
  return hasTagFormErrors(errors) ? { errors } : { data, errors };
}

/**
 * 编辑器里可以添加的标签：去掉已经选了的，按名称、各语言译名或 slug 筛选（不分大小写）。
 * 没有输入时只给最常用的 limit 个（列表已按使用次数排好），避免标签多了以后铺满一屏；输入时给全部匹配项。
 */
export function tagSuggestions(all: AdminTag[], selectedSlugs: string[], query: string, limit: number): AdminTag[] {
  const selected = new Set(selectedSlugs);
  const q = query.trim().toLowerCase();
  const available = all.filter((tag) => !selected.has(tag.slug));
  if (!q) return available.slice(0, limit);
  const matches = (text: string | undefined) => text !== undefined && text.toLowerCase().includes(q);
  return available.filter((tag) => matches(tag.name) || tag.slug.includes(q) || Object.values(tag.translations).some(matches));
}

/** 后台界面上的语言名（中文写法："英语"、"日语"），由 BCP 47 标签算出，不写死 */
const languageNames = new Intl.DisplayNames(["zh-CN"], { type: "language" });
export const adminLanguageName = (locale: Locale): string => languageNames.of(locale) ?? locale;

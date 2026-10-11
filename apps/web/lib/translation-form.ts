import {
  type AdminPost,
  type AdminTranslation,
  type AdminTranslationSummary,
  type Locale,
  locales,
  type PostStatus,
  type TranslationInput,
  translationInputSchema,
  type TranslationOrigin,
} from "@blog/shared";
import type { AdminApiIssue } from "./admin-api";
import { adminLocaleName } from "./admin-format";
import { toApiIssues } from "./post-form";

/*
 * 译文编辑的纯逻辑：表单值 ↔ API 输入、改动检测、错误归位、各语言的译文状态。
 * 和 lib/post-form.ts 同样不依赖 React 和浏览器。后台界面只有中文，这里的文案直接写中文。
 */

/** 译文只有标题和正文可编辑：slug 各语言相同，标签不翻译，摘要由 API 从正文生成 */
export type TranslationFormValues = {
  title: string;
  contentMd: string;
};

export type TranslationFormField = keyof TranslationFormValues;

export type TranslationFormErrors = Partial<Record<TranslationFormField | "form", string>>;

export const emptyTranslationForm: TranslationFormValues = { title: "", contentMd: "" };

export function formFromTranslation(translation: AdminTranslation): TranslationFormValues {
  return { title: translation.title, contentMd: translation.contentMd };
}

/**
 * "复制原文作为起点"：把原文的标题和正文原样填进来，作者再逐段替换成译文。
 * 好处是代码块、图片（含 #尺寸 片段）、链接地址这些不该翻译的结构天然保留，不用对着原文重新敲一遍。
 */
export function formFromSource(post: Pick<AdminPost, "title" | "contentMd">): TranslationFormValues {
  return { title: post.title, contentMd: post.contentMd };
}

export function isTranslationDirty(initial: TranslationFormValues, current: TranslationFormValues): boolean {
  return current.title !== initial.title || current.contentMd !== initial.contentMd;
}

/**
 * 点"保存"时要不要发请求。内容没改也可能需要保存：原文只改了错别字、译文不用动时，
 * 作者对照后直接保存，就是用当前原文的指纹把译文标记为已同步。
 * 所以只有"已有译文 + 内容没改 + 依据的已经是当前原文"才跳过。
 */
export function needsSave(saved: Pick<AdminTranslation, "sourceHash"> | null, dirty: boolean, sourceHash: string): boolean {
  return saved === null || dirty || saved.sourceHash !== sourceHash;
}

// ---------- 还没翻译的内容 ----------

/**
 * 和原文一模一样的字段（不计首尾空白）。原文正文为空时正文不算：本来就没有可翻译的内容。
 * "复制原文作为起点"之后，没替换的字段就是这样。
 */
export function untranslatedFields(values: TranslationFormValues, source: Pick<AdminPost, "title" | "contentMd">): TranslationFormField[] {
  const fields: TranslationFormField[] = [];
  if (values.title.trim() === source.title.trim()) fields.push("title");
  if (source.contentMd.trim() !== "" && values.contentMd.trim() === source.contentMd.trim()) fields.push("contentMd");
  return fields;
}

export type UntranslatedCheck = { kind: "ok" } | { kind: "refuse" } | { kind: "confirm"; fields: TranslationFormField[] };

/**
 * 保存前检查是不是还没翻译。译文没有草稿状态，文章已发布时一保存读者就能看到：
 * 原文冒充成英文 / 日文页面、进入该语言的列表和 hreflang，比"暂时没有译文"更糟（内容准确优先于译文齐全）。
 *   - 标题和正文都还是原文（比如复制原文后顺手按了 ⌘S）：拒绝保存
 *   - 只有一项还是原文：要作者确认——产品名之类的标题各语言可能本来就相同，不能一律拦下。
 *     已保存的译文里本来就和原文相同的字段不再问（之前确认过）
 */
export function checkUntranslated(
  values: TranslationFormValues,
  source: Pick<AdminPost, "title" | "contentMd">,
  saved: TranslationFormValues | null,
): UntranslatedCheck {
  if (values.title.trim() === source.title.trim() && values.contentMd.trim() === source.contentMd.trim()) return { kind: "refuse" };
  const fields = untranslatedFields(values, source).filter((field) => saved === null || saved[field].trim() !== values[field].trim());
  return fields.length > 0 ? { kind: "confirm", fields } : { kind: "ok" };
}

/**
 * PUT 请求体。sourceHash 传编辑器加载文章时拿到的 AdminPost.sourceHash，而不是保存那一刻再取一次：
 * 译文是对着"加载时那一版原文"写的，如果原文在编辑期间被别处改过，保存后仍应显示为过时。
 */
export function buildTranslationInput(values: TranslationFormValues, sourceHash: string): TranslationInput {
  return { title: values.title, contentMd: values.contentMd, sourceHash };
}

function fieldForPath(path: string): TranslationFormField | "form" {
  const head = path.split(".")[0];
  return head === "title" || head === "contentMd" ? head : "form";
}

/** API 的字段错误归到表单字段上；sourceHash 之类不在表单里的字段归到 form（同一字段只留第一条） */
export function issuesToTranslationErrors(issues: AdminApiIssue[]): TranslationFormErrors {
  const errors: TranslationFormErrors = {};
  for (const issue of issues) {
    errors[fieldForPath(issue.path)] ??= issue.message;
  }
  return errors;
}

/** 提交前用 shared 的同一个 schema 校验，错误和服务端 400 走同一条显示路径（同 validatePostForm） */
export function validateTranslationForm(values: TranslationFormValues, sourceHash: string): TranslationFormErrors {
  const result = translationInputSchema.safeParse(buildTranslationInput(values, sourceHash));
  return result.success ? {} : issuesToTranslationErrors(toApiIssues(result.error.issues));
}

// ---------- 各语言的译文状态 ----------

/**
 * missing   还没有这种语言的译文
 * synced    译文依据的就是当前原文
 * outdated  原文在译文之后改过（以服务端算的 outdated 为准：前端拿不到原文指纹的算法，也不该自己算）
 */
export type TranslationState = "missing" | "synced" | "outdated";

export const translationStateLabels: Record<TranslationState, string> = {
  missing: "尚无译文",
  synced: "已同步",
  outdated: "原文已更新",
};

export function translationState(summary: Pick<AdminTranslationSummary, "outdated"> | null): TranslationState {
  if (!summary) return "missing";
  return summary.outdated ? "outdated" : "synced";
}

export type TranslationTarget = {
  locale: Locale;
  /** 后台用的语言名（中文：英语 / 日语，见 adminLocaleName） */
  name: string;
  summary: AdminTranslationSummary | null;
  state: TranslationState;
};

/**
 * 一篇文章可以有哪些译文：除原文语言外的每种语言各一项，按 locales 的顺序。
 * 从 locales 推导而不是只列已有的译文：编辑页要给"还没有译文"的语言显示"添加译文"入口。
 */
export function translationTargets(post: Pick<AdminPost, "sourceLocale" | "translations">): TranslationTarget[] {
  return locales
    .filter((locale) => locale !== post.sourceLocale)
    .map((locale) => {
      const summary = post.translations.find((t) => t.locale === locale) ?? null;
      return { locale, name: adminLocaleName(locale), summary, state: translationState(summary) };
    });
}

/** 原文语言本身不能有译文（API 同样拒绝，这里提前拦下，不给出入口） */
export function canTranslateTo(post: Pick<AdminPost, "sourceLocale">, locale: Locale): boolean {
  return locale !== post.sourceLocale;
}

export function originLabel(origin: TranslationOrigin, model: string | null): string {
  if (origin === "human") return "人工翻译";
  return model ? `机器翻译（${model}）` : "机器翻译";
}

/** 文章列表里的语言小标记：EN / JA（只看两个字母就够分辨，列表里放不下语言全名） */
export function localeShortLabel(locale: Locale): string {
  return locale.toUpperCase();
}

/** 译文没有单独的草稿状态：文章已发布时保存即对读者生效，要在保存按钮旁说清楚 */
export function translationSaveHint(status: PostStatus): string {
  return status === "published" ? "文章已发布，保存后读者立即可见" : "文章还是草稿，发布后译文才对读者可见";
}

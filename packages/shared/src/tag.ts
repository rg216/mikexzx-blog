import { z } from "zod";
import { defaultSourceLocale, type Locale, localeSchema, locales } from "./locale.ts";
import { slugSchema, tagNameSchema } from "./post.ts";
import { translationUsageSchema } from "./translation.ts";

/*
 * 标签集中管理（后台 /admin/posts/tags）：创建、改名、合并、删除都在那里做，
 * 编辑文章时只能从已有标签里选——避免随手造出"前端"、"Frontend"、"前端开发"这样意思重复的标签。
 *
 * 标签名按语言显示：tags.name 是原文语言（tagSourceLocale）的名称，其他每种语言一个译名（tag_translations）。
 * 新建、编辑标签时译名必填：标签很短，一次填齐的成本很低，而前台每种语言的页面上都会显示它。
 */

const id = z.int().positive();

/** tags.name 的语言。标签不跟随文章的原文语言：同一个标签被各种语言的文章共用 */
export const tagSourceLocale: Locale = defaultSourceLocale;

/** 需要译名的语言：除原文语言外的所有语言（加一种语言时这里自动包含它） */
export const tagTranslationLocales: readonly Locale[] = locales.filter((locale) => locale !== tagSourceLocale);

/** 各语言的译名（不含原文语言）。旧标签可能还没有译名，所以读出来的是"部分"的 */
export type TagTranslations = Partial<Record<Locale, string>>;

/**
 * 提交的译名：每种需要译名的语言都要有、不能多出原文语言。
 * 缺的语言报在对应的路径上（translations.en），表单据此把错误放到那一栏。
 */
export const tagTranslationsInputSchema = z.partialRecord(localeSchema, tagNameSchema).superRefine((value, ctx) => {
  for (const locale of tagTranslationLocales) {
    if (value[locale] === undefined) ctx.addIssue({ code: "custom", path: [locale], message: "请填写译名" });
  }
  for (const locale of Object.keys(value)) {
    if (!tagTranslationLocales.includes(locale as Locale)) ctx.addIssue({ code: "custom", path: [locale], message: "原文语言的名称就是标签名，不需要译名" });
  }
});

export const adminTagSchema = z.object({
  id,
  slug: slugSchema,
  /** 原文语言（tagSourceLocale）的名称 */
  name: z.string(),
  /** 已有的译名；缺少某种语言时，前台那种语言显示原文名称 */
  translations: z.partialRecord(localeSchema, z.string()),
  /** 用到它的文章数（含草稿） */
  postCount: z.int().nonnegative(),
  /** 其中已发布的篇数（前台显示的数字） */
  publishedCount: z.int().nonnegative(),
});
export type AdminTag = z.infer<typeof adminTagSchema>;

export const tagInputSchema = z.strictObject({ slug: slugSchema, name: tagNameSchema, translations: tagTranslationsInputSchema });
export type TagInput = z.input<typeof tagInputSchema>;

/** 部分更新；给了 translations 就必须是全部语言（整体替换） */
export const tagUpdateInputSchema = tagInputSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, "至少需要更新一个字段");
export type TagUpdateInput = z.input<typeof tagUpdateInputSchema>;

/** 把一个标签合并进另一个：用到它的文章改用 into，然后删掉它 */
export const tagMergeInputSchema = z.strictObject({ into: id });
export type TagMergeInput = z.input<typeof tagMergeInputSchema>;

/** 某个标签缺哪些语言的译名（后台列表据此提示） */
export function missingTagTranslations(tag: Pick<AdminTag, "translations">): Locale[] {
  return tagTranslationLocales.filter((locale) => !tag.translations[locale]?.trim());
}

// ---------- 大模型翻译标签名 ----------

/**
 * 请大模型给标签名起各语言的译名。和文章翻译一样只由作者触发，结果只回给编辑框，保存后才生效。
 * 翻译的是表单里此刻的名称（新建标签时还没有 id）；slug 通常是英文，帮模型判断意思。
 */
export const tagTranslateInputSchema = z.strictObject({
  name: tagNameSchema,
  slug: z.union([slugSchema, z.literal("")]).default(""),
});
export type TagTranslateInput = z.input<typeof tagTranslateInputSchema>;

export const tagTranslateResultSchema = z.object({
  /** 每种需要译名的语言一个 */
  translations: z.partialRecord(localeSchema, z.string()),
  /** 实际服务的模型 */
  model: z.string(),
  usage: translationUsageSchema,
});
export type TagTranslateResult = z.infer<typeof tagTranslateResultSchema>;

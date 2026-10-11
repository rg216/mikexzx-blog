import { z } from "zod";
import { postImageMetaSchema } from "./image.ts";
import { defaultLocale, localeSchema } from "./locale.ts";

// API 的 JSON 字段统一用 camelCase（JS 惯例）；数据库列用 snake_case，由 Drizzle 负责映射。

/** URL 友好的标识：小写字母、数字、单个连字符分隔。 */
export const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug 只能包含小写字母、数字和单个连字符");

const isoDateTime = z.iso.datetime({ offset: true });

export const postStatusSchema = z.enum(["draft", "published"]);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const tagSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(50),
});
export type Tag = z.infer<typeof tagSchema>;

export const tagWithCountSchema = tagSchema.extend({
  /** 使用该标签的已发布文章数 */
  count: z.int().nonnegative(),
});
export type TagWithCount = z.infer<typeof tagWithCountSchema>;

// ---------- 输出 ----------

export const postSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  contentMd: z.string(),
  /** 纯文本摘要，由 API 在写入时从正文生成。 */
  excerpt: z.string(),
  status: postStatusSchema,
  /** 首次发布时间（ISO 8601）；从未发布过为 null。撤回为草稿时保留，重新发布不会改变它。 */
  publishedAt: isoDateTime.nullable(),
  tags: z.array(tagSchema),
  /** 正文引用的媒体库图片（按原图 key 索引），渲染时用来加宽高和 srcset；尺寸未知的不在里面 */
  images: z.record(z.string(), postImageMetaSchema),
  /** title / contentMd / excerpt 实际是哪种语言（请求的语言没有译文时，公开接口返回原文，这里就是原文语言） */
  locale: localeSchema,
});
export type Post = z.infer<typeof postSchema>;

/** 列表项：不带正文（列表页不需要传输全文）。 */
export const postSummarySchema = postSchema.omit({ contentMd: true, images: true });
export type PostSummary = z.infer<typeof postSummarySchema>;

/** 译文的来源：machine 由 LLM 生成（v5.5），human 是作者手工编写或修改过的 */
export const translationOriginSchema = z.enum(["machine", "human"]);
export type TranslationOrigin = z.infer<typeof translationOriginSchema>;

/** 公开接口里一篇译文的状态；读者看的是原文时为 null */
export const publicTranslationInfoSchema = z.object({
  origin: translationOriginSchema,
  translatedAt: isoDateTime,
  /** 译文生成之后原文又改过（source_hash 与当前原文的指纹不一致） */
  outdated: z.boolean(),
});
export type PublicTranslationInfo = z.infer<typeof publicTranslationInfoSchema>;

/** 公开接口的单篇文章：按请求的语言返回，没有该语言的译文时返回原文（locale 为原文语言）。 */
export const publicPostSchema = postSchema.extend({
  sourceLocale: localeSchema,
  /** 这篇文章有哪些语言版本（原文 + 已有的译文），用于 hreflang 和切换语言 */
  availableLocales: z.array(localeSchema),
  translation: publicTranslationInfoSchema.nullable(),
});
export type PublicPost = z.infer<typeof publicPostSchema>;

/** 原文指纹：SHA-256（十六进制），由 API 根据原文的标题和正文计算 */
export const sourceHashSchema = z.string().regex(/^[0-9a-f]{64}$/, "无效的原文指纹");

/** 管理接口里的译文概要（不带正文） */
export const adminTranslationSummarySchema = z.object({
  locale: localeSchema,
  title: z.string(),
  origin: translationOriginSchema,
  /** 生成译文的模型（机器翻译）；人工译文为 null */
  model: z.string().nullable(),
  translatedAt: isoDateTime,
  /** 生成 / 保存译文时所依据的原文指纹 */
  sourceHash: sourceHashSchema,
  /** sourceHash 与当前原文的指纹不一致：原文在译文之后改过 */
  outdated: z.boolean(),
});
export type AdminTranslationSummary = z.infer<typeof adminTranslationSummarySchema>;

export const adminTranslationSchema = adminTranslationSummarySchema.extend({
  contentMd: z.string(),
  excerpt: z.string(),
});
export type AdminTranslation = z.infer<typeof adminTranslationSchema>;

/** 管理接口返回的文章：多了内部 id、时间戳和译文信息。公开接口只用 slug 定位文章。locale 即原文语言。 */
export const adminPostSchema = postSchema.extend({
  id: z.int().positive(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  sourceLocale: localeSchema,
  /** 当前原文的指纹，保存译文时原样传回（表示译文是依据这一版原文写的） */
  sourceHash: sourceHashSchema,
  /** 已有的译文，按 locales 的顺序 */
  translations: z.array(adminTranslationSummarySchema),
});
export type AdminPost = z.infer<typeof adminPostSchema>;

/** 游标分页：nextCursor 为 null 表示没有下一页。游标是不透明字符串，客户端原样传回即可。 */
export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export const postSummaryPageSchema = paginatedSchema(postSummarySchema);
export type PostSummaryPage = z.infer<typeof postSummaryPageSchema>;

// ---------- 输入 ----------

export const listPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(200).optional(),
  /** 列出哪种语言的文章：原文是该语言的，或者有该语言译文的 */
  locale: localeSchema.default(defaultLocale),
});
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;

// strictObject：多余字段直接报错，而不是悄悄丢弃——拼错字段名（如 contentMD）能立刻发现。
const postInputFields = {
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  contentMd: z.string().max(200_000),
  status: postStatusSchema,
  /** 一般不传：首次发布时由服务端填当前时间。导入旧文章时可以显式指定。 */
  publishedAt: isoDateTime.nullable(),
  tags: z.array(tagSchema).max(20),
};

export const postCreateInputSchema = z.strictObject({
  ...postInputFields,
  status: postInputFields.status.default("draft"),
  publishedAt: postInputFields.publishedAt.optional(),
  tags: postInputFields.tags.default([]),
});
export type PostCreateInput = z.input<typeof postCreateInputSchema>;

// 更新是部分更新（PATCH）：所有字段可选，且没有默认值——否则没传 status 也会被重置成 draft。
export const postUpdateInputSchema = z
  .strictObject(postInputFields)
  .partial()
  .refine((input) => Object.keys(input).length > 0, "至少需要更新一个字段");
export type PostUpdateInput = z.input<typeof postUpdateInputSchema>;

/**
 * 保存（新建或整体替换）一篇译文：PUT /admin/posts/:id/translations/:locale。
 * 摘要和搜索索引由 API 生成；origin 一律记为 human。
 */
export const translationInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  contentMd: z.string().max(200_000),
  /** 译文依据的原文指纹（编辑器加载文章时拿到的 AdminPost.sourceHash）：原文在此之后又改过的话，译文仍会显示为过时 */
  sourceHash: sourceHashSchema,
});
export type TranslationInput = z.input<typeof translationInputSchema>;

// ---------- 错误 ----------

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(["validation_error", "unauthorized", "forbidden", "not_found", "conflict", "rate_limited", "internal_error"]),
    message: z.string(),
    /** 校验错误的明细，字段路径 + 原因 */
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorCode = ApiError["error"]["code"];

/** 阅读数；服务端没有配置 Redis 时为 null（前端不显示） */
export const viewCountSchema = z.object({ views: z.int().nonnegative().nullable() });
export type ViewCount = z.infer<typeof viewCountSchema>;

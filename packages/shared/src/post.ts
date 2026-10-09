import { z } from "zod";

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
});
export type Post = z.infer<typeof postSchema>;

/** 列表项：不带正文（列表页不需要传输全文）。 */
export const postSummarySchema = postSchema.omit({ contentMd: true });
export type PostSummary = z.infer<typeof postSummarySchema>;

/** 管理接口返回的文章：多了内部 id 和时间戳。公开接口只用 slug 定位文章。 */
export const adminPostSchema = postSchema.extend({
  id: z.int().positive(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
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

// ---------- 错误 ----------

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(["validation_error", "unauthorized", "forbidden", "not_found", "conflict", "internal_error"]),
    message: z.string(),
    /** 校验错误的明细，字段路径 + 原因 */
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorCode = ApiError["error"]["code"];

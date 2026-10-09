import { z } from "zod";

// API 的 JSON 字段统一用 camelCase（JS 惯例）；数据库列用 snake_case，由 Drizzle 负责映射。

/** URL 友好的标识：小写字母、数字、单个连字符分隔。 */
export const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug 只能包含小写字母、数字和单个连字符");

export const postStatusSchema = z.enum(["draft", "published"]);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const tagSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(50),
});
export type Tag = z.infer<typeof tagSchema>;

export const postSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  contentMd: z.string(),
  status: postStatusSchema,
  /** ISO 8601 时间戳；草稿为 null。 */
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  tags: z.array(tagSchema),
});
export type Post = z.infer<typeof postSchema>;

/** 列表项：不带正文，带摘要（列表页不需要传输全文）。 */
export const postSummarySchema = postSchema.omit({ contentMd: true }).extend({
  excerpt: z.string(),
});
export type PostSummary = z.infer<typeof postSummarySchema>;

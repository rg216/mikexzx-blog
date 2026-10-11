import { z } from "zod";
import { slugSchema, tagNameSchema } from "./post.ts";

/*
 * 标签集中管理（后台 /admin/posts/tags）：创建、改名、合并、删除都在那里做，
 * 编辑文章时只能从已有标签里选——避免随手造出"前端"、"Frontend"、"前端开发"这样意思重复的标签。
 */

const id = z.int().positive();

export const adminTagSchema = z.object({
  id,
  slug: slugSchema,
  name: z.string(),
  /** 用到它的文章数（含草稿） */
  postCount: z.int().nonnegative(),
  /** 其中已发布的篇数（前台显示的数字） */
  publishedCount: z.int().nonnegative(),
});
export type AdminTag = z.infer<typeof adminTagSchema>;

export const tagInputSchema = z.strictObject({ slug: slugSchema, name: tagNameSchema });
export type TagInput = z.input<typeof tagInputSchema>;

export const tagUpdateInputSchema = tagInputSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, "至少需要更新一个字段");
export type TagUpdateInput = z.input<typeof tagUpdateInputSchema>;

/** 把一个标签合并进另一个：用到它的文章改用 into，然后删掉它 */
export const tagMergeInputSchema = z.strictObject({ into: id });
export type TagMergeInput = z.input<typeof tagMergeInputSchema>;

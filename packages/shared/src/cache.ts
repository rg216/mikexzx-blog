import { z } from "zod";

/*
 * 前端页面缓存的标签：前端取数据时打上，API 写入后按标签通知前端失效。
 * 两边共用这里的定义，避免一边写 "post:" 一边写 "posts:" 这种拼写不一致。
 */
export const cacheTags = {
  /** 所有"文章列表类"数据：首页、标签统计、侧栏最近文章、静态路径列表 */
  posts: "posts",
  /** 单篇文章 */
  post: (slug: string) => `post:${slug}`,
} as const;

/** API → 前端 /hooks/revalidate 的请求体 */
export const revalidateRequestSchema = z.strictObject({
  tags: z
    .array(z.string().min(1).max(256))
    .min(1)
    .max(20),
});
export type RevalidateRequest = z.infer<typeof revalidateRequestSchema>;

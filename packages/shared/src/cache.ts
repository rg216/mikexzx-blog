import { z } from "zod";
import type { Locale } from "./locale.ts";

/*
 * 前端页面缓存的标签：前端取数据时打上，API 写入后按标签通知前端失效。
 * 两边共用这里的定义，避免一边写 "post:" 一边写 "posts:" 这种拼写不一致。
 * 每种语言的页面各自缓存、各自失效：保存英文译文不会让中文、日文页面重新生成。
 */
export const cacheTags = {
  /** 某种语言的"文章列表类"数据：首页、标签统计、侧栏最近文章、静态路径列表 */
  posts: (locale: Locale) => `posts:${locale}`,
  /** 某种语言的单篇文章页 */
  post: (slug: string, locale: Locale) => `post:${slug}:${locale}`,
} as const;

/** 一次通知最多带的标签数；更多时由 API 分批发送 */
export const REVALIDATE_MAX_TAGS = 50;

/** API → 前端 /hooks/revalidate 的请求体 */
export const revalidateRequestSchema = z.strictObject({
  tags: z
    .array(z.string().min(1).max(256))
    .min(1)
    .max(REVALIDATE_MAX_TAGS),
});
export type RevalidateRequest = z.infer<typeof revalidateRequestSchema>;

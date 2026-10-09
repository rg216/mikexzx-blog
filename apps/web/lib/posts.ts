import {
  type Post,
  postSchema,
  type PostSummary,
  postSummaryPageSchema,
  type TagWithCount,
  tagWithCountSchema,
} from "@blog/shared";
import { z } from "zod";
import { apiGet } from "./api";

/*
 * 数据访问层：调用 apps/api，返回 @blog/shared 的类型。
 * v0 时这里读本地假数据，函数签名一开始就是异步的，所以换成 HTTP 后页面代码不用改。
 */

export type PublishedPost = Post & { status: "published"; publishedAt: string };

function isPublished(post: Post): post is PublishedPost {
  return post.status === "published" && post.publishedAt !== null;
}

/** 最新的一页已发布文章。 */
export async function listPublishedPosts({ limit = 20 }: { limit?: number } = {}): Promise<PostSummary[]> {
  const page = await apiGet(`/posts?limit=${limit}`, postSummaryPageSchema);
  return page.items;
}

/** 全部已发布文章（生成静态路径用）：沿着游标一页页取，直到没有下一页。 */
export async function listAllPublishedPosts(): Promise<PostSummary[]> {
  const all: PostSummary[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    const page = await apiGet(`/posts?${params}`, postSummaryPageSchema);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/** 按 slug 取已发布文章；草稿或不存在都返回 null（API 对两者都返回 404，不泄露草稿是否存在）。 */
export async function getPublishedPost(slug: string): Promise<PublishedPost | null> {
  const post = await apiGet(`/posts/${encodeURIComponent(slug)}`, postSchema, { notFoundAsNull: true });
  return post && isPublished(post) ? post : null;
}

/** 已发布文章用到的标签及篇数。 */
export async function listTags(): Promise<TagWithCount[]> {
  return apiGet("/tags", z.array(tagWithCountSchema));
}

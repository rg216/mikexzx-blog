import {
  cacheTags,
  type Locale,
  type PostSummary,
  postSummaryPageSchema,
  type PublicPost,
  publicPostSchema,
  type TagWithCount,
  tagWithCountSchema,
} from "@blog/shared";
import { z } from "zod";
import { apiGet } from "./api";

/*
 * 数据访问层：调用 apps/api，返回 @blog/shared 的类型。
 * v0 时这里读本地假数据，函数签名一开始就是异步的，所以换成 HTTP 后页面代码不用改。
 *
 * 每种语言的数据分开请求、分开缓存：列表类打 posts:<locale>，单篇打 post:<slug>:<locale>。
 * 保存英文译文时 API 只让英文的标签失效，中文、日文页面不用重新生成。
 * 文章页的侧栏也用到了列表，所以某种语言的任何文章变化都会让该语言的所有文章页失效——对小博客来说正好。
 */

export type PublishedPost = PublicPost & { status: "published"; publishedAt: string };

function isPublished(post: PublicPost): post is PublishedPost {
  return post.status === "published" && post.publishedAt !== null;
}

/** 某种语言下最新的一页已发布文章：原文是该语言的，或者有该语言译文的（没有译文的文章不出现，避免重复内容）。 */
export async function listPublishedPosts({ limit = 20, locale }: { limit?: number; locale: Locale }): Promise<PostSummary[]> {
  const params = new URLSearchParams({ limit: String(limit), locale });
  const page = await apiGet(`/posts?${params}`, postSummaryPageSchema, { tags: [cacheTags.posts(locale)] });
  return page.items;
}

/** 某种语言下的全部已发布文章（生成静态路径用）：沿着游标一页页取，直到没有下一页。 */
export async function listAllPublishedPosts(locale: Locale): Promise<PostSummary[]> {
  const all: PostSummary[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "50", locale });
    if (cursor) params.set("cursor", cursor);
    const page = await apiGet(`/posts?${params}`, postSummaryPageSchema, { tags: [cacheTags.posts(locale)] });
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/**
 * 按 slug 取已发布文章的某个语言版本；草稿或不存在都返回 null（API 对两者都返回 404，不泄露草稿是否存在）。
 * 该语言没有译文时 API 返回原文：post.locale 是原文语言，页面据此显示提示。
 */
export async function getPublishedPost(slug: string, locale: Locale): Promise<PublishedPost | null> {
  const post = await apiGet(`/posts/${encodeURIComponent(slug)}?${new URLSearchParams({ locale })}`, publicPostSchema, {
    notFoundAsNull: true,
    tags: [cacheTags.post(slug, locale)],
  });
  return post && isPublished(post) ? post : null;
}

/** 某种语言下可见的已发布文章用到的标签及篇数。 */
export async function listTags(locale: Locale): Promise<TagWithCount[]> {
  return apiGet(`/tags?${new URLSearchParams({ locale })}`, z.array(tagWithCountSchema), { tags: [cacheTags.posts(locale)] });
}

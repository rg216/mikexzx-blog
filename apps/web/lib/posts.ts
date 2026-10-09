import { postSchema, type Post, type PostSummary } from "@blog/shared";
import { z } from "zod";
import { rawPosts } from "@/content/posts";
import { excerptFromMarkdown } from "./markdown";

/*
 * 数据访问层。v0 读本地假数据；v1 改成调用 apps/api。
 * 函数签名从现在起就是异步的、返回 shared 里的类型——到时只换实现，页面不用动。
 */

// 假数据也是"外部输入"：启动时用同一套 schema 校验，写错了构建直接失败。
const posts: Post[] = z.array(postSchema).parse(rawPosts);

export type PublishedPost = Post & { status: "published"; publishedAt: string };

function isPublished(post: Post): post is PublishedPost {
  return post.status === "published" && post.publishedAt !== null;
}

function toSummary(post: Post): PostSummary {
  const { contentMd, ...rest } = post;
  return { ...rest, excerpt: excerptFromMarkdown(contentMd) };
}

/** 已发布文章，按发布时间倒序。 */
export async function listPublishedPosts(): Promise<PostSummary[]> {
  return posts
    .filter(isPublished)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map(toSummary);
}

/** 按 slug 取已发布文章；草稿或不存在都返回 null（对外不区分，避免泄露草稿是否存在）。 */
export async function getPublishedPost(slug: string): Promise<PublishedPost | null> {
  const post = posts.find((p) => p.slug === slug);
  return post && isPublished(post) ? post : null;
}

import { describe, expect, it } from "vitest";
import { getPublishedPost, listPublishedPosts, listTags } from "./posts";

describe("listPublishedPosts", () => {
  it("excludes drafts", async () => {
    const posts = await listPublishedPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.status === "published")).toBe(true);
  });

  it("sorts by publish date, newest first", async () => {
    const times = (await listPublishedPosts()).map((p) => Date.parse(p.publishedAt ?? ""));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("returns summaries without the full content", async () => {
    const [first] = await listPublishedPosts();
    expect(first).not.toHaveProperty("contentMd");
    expect(first?.excerpt.length).toBeGreaterThan(0);
  });
});

describe("getPublishedPost", () => {
  it("returns a published post by slug", async () => {
    const post = await getPublishedPost("why-build-a-blog-from-scratch");
    expect(post?.title).toBe("为什么要从零写一个博客");
  });

  it("returns null for drafts", async () => {
    expect(await getPublishedPost("v1-api-plan")).toBeNull();
  });

  it("returns null for unknown slugs", async () => {
    expect(await getPublishedPost("does-not-exist")).toBeNull();
  });
});

describe("listTags", () => {
  it("counts tags across published posts only, most used first", async () => {
    const tags = await listTags();
    const counts = tags.map((t) => t.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    // "全栈" 用在 3 篇已发布文章 + 1 篇草稿上，草稿不计
    expect(tags.find((t) => t.slug === "fullstack")?.count).toBe(3);
  });
});

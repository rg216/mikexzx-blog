import { searchResultSchema } from "@blog/shared";
import { eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { posts } from "../src/db/schema.ts";
import { reindexPosts } from "../src/services/posts.ts";
import { setupTestApp } from "./helpers.ts";

const { db, request, createPost } = setupTestApp();

async function search(q: string) {
  const res = await request("GET", `/search?q=${encodeURIComponent(q)}`, { auth: false });
  expect(res.status).toBe(200);
  return searchResultSchema.parse(res.body).items;
}

const slugs = async (q: string) => (await search(q)).map((hit) => hit.slug);
const published = { status: "published" } as const;

describe("GET /search", () => {
  it("finds Chinese phrases anywhere in the body", async () => {
    await createPost({ slug: "fullstack", title: "随笔", contentMd: "这个博客是为了练习全栈开发。", ...published });
    await createPost({ slug: "other", title: "另一篇", contentMd: "和前端无关的内容。", ...published });

    expect(await slugs("全栈开发")).toEqual(["fullstack"]);
    expect(await slugs("栈开")).toEqual(["fullstack"]);
    expect(await slugs("全栈 内容")).toEqual([]);
  });

  it("finds single CJK characters, word prefixes, and ignores case and width", async () => {
    await createPost({ slug: "hono", title: "Deploying Hono", contentMd: "博客的 API 用 Hono。", ...published });

    expect(await slugs("博")).toEqual(["hono"]);
    expect(await slugs("deploy")).toEqual(["hono"]);
    expect(await slugs("ＨＯＮＯ")).toEqual(["hono"]);
    expect(await slugs("ploy")).toEqual([]);
  });

  it("finds posts by tag name", async () => {
    await createPost({ slug: "tagged", contentMd: "正文", tags: [{ slug: "typography", name: "排版" }], ...published });
    expect(await slugs("排版")).toEqual(["tagged"]);
  });

  it("ranks title matches above body matches", async () => {
    await createPost({ slug: "body", title: "随笔", contentMd: "顺便提一下缓存。", ...published, publishedAt: "2026-02-01T00:00:00Z" });
    await createPost({ slug: "title", title: "缓存策略", contentMd: "正文", ...published, publishedAt: "2026-01-01T00:00:00Z" });
    expect(await slugs("缓存")).toEqual(["title", "body"]);
  });

  it("never returns drafts", async () => {
    await createPost({ slug: "secret", title: "未发布的草稿", contentMd: "草稿内容" });
    expect(await slugs("草稿")).toEqual([]);
  });

  it("returns highlighted title and snippet ranges", async () => {
    await createPost({ slug: "hl", title: "全栈练习", contentMd: `${"铺垫".repeat(60)}然后开始全栈开发。`, ...published });
    const [hit] = await search("全栈开发");
    if (!hit) throw new Error("no hit");

    const marked = ({ text, highlights }: { text: string; highlights: { start: number; end: number }[] }) =>
      highlights.map(({ start, end }) => text.slice(start, end));
    expect(marked(hit.title)).toEqual(["全栈"]);
    expect(marked(hit.snippet)).toEqual(["全栈开发"]);
    expect(hit.snippet.text.startsWith("…")).toBe(true);
    expect(hit).not.toHaveProperty("contentMd");
  });

  it("reflects edits to title, content and tags", async () => {
    const post = await createPost({ slug: "edit", title: "旧标题", contentMd: "旧内容", ...published });
    await request("PATCH", `/admin/posts/${post.id}`, { body: { title: "新标题", contentMd: "新内容" } });
    expect(await slugs("旧内容")).toEqual([]);
    expect(await slugs("新内容")).toEqual(["edit"]);

    await request("PATCH", `/admin/posts/${post.id}`, { body: { tags: [{ slug: "t", name: "标签名" }] } });
    expect(await slugs("标签名")).toEqual(["edit"]);
    // 只改标签时标题仍然可搜（索引用的是库里的当前值）
    expect(await slugs("新标题")).toEqual(["edit"]);

    await request("PATCH", `/admin/posts/${post.id}`, { body: { title: "第三个标题" } });
    expect(await slugs("第三个")).toEqual(["edit"]);
    expect(await slugs("标签名 新内容")).toEqual(["edit"]);
  });

  it("reindexes other posts when a shared tag is renamed, without touching their updatedAt", async () => {
    const a = await createPost({ slug: "a", contentMd: "甲", tags: [{ slug: "web", name: "网页" }], ...published });
    const [before] = await db.select({ updatedAt: posts.updatedAt }).from(posts).where(eq(posts.id, a.id));
    await createPost({ slug: "b", contentMd: "乙", tags: [{ slug: "web", name: "前端" }], ...published });

    expect(await slugs("网页")).toEqual([]);
    expect((await slugs("前端")).sort()).toEqual(["a", "b"]);
    const [after] = await db.select({ updatedAt: posts.updatedAt }).from(posts).where(eq(posts.id, a.id));
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("returns nothing for queries without searchable characters", async () => {
    await createPost({ slug: "x", contentMd: "内容", ...published });
    expect(await search("！？ ---")).toEqual([]);
  });

  it("treats tsquery syntax in the input as plain text", async () => {
    await createPost({ slug: "x", contentMd: "hello world", ...published });
    expect(await slugs("hello' | !world:* <->")).toEqual(["x"]);
  });

  it("validates the query", async () => {
    expect((await request("GET", "/search", { auth: false })).status).toBe(400);
    expect((await request("GET", "/search?q=%20%20", { auth: false })).status).toBe(400);
    expect((await request("GET", `/search?q=${"a".repeat(101)}`, { auth: false })).status).toBe(400);
  });

  it("indexes posts of the maximum allowed size", async () => {
    // 20 万字随机汉字：二元组几乎不重复，最考验 tsvector 的 1MB 上限
    const chars = Array.from({ length: 200_000 }, () => String.fromCodePoint(0x4e00 + Math.floor(Math.random() * 20_000)));
    await createPost({ slug: "huge", contentMd: `${chars.join("")}`, ...published });
    const start = chars.slice(10, 14).join("");
    expect(await slugs(start)).toEqual(["huge"]);
  });

  it("backfills posts whose index is missing (e.g. after a migration)", async () => {
    const post = await createPost({ slug: "old", contentMd: "迁移之前的文章", ...published });
    await db.update(posts).set({ searchVector: sql`NULL` }).where(eq(posts.id, post.id));
    expect(await slugs("迁移")).toEqual([]);

    expect(await reindexPosts(db, isNull(posts.searchVector))).toBe(1);
    expect(await slugs("迁移")).toEqual(["old"]);
  });
});

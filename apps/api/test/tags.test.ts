import { adminPostSchema, adminTagSchema, searchResultSchema } from "@blog/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { posts, tags } from "../src/db/schema.ts";
import { tagsForPublishedPosts } from "../src/lib/revalidate.ts";
import { setupTestApp } from "./helpers.ts";

const { db, request, createPost, createTag, revalidations } = setupTestApp();

const published = { status: "published" } as const;

async function listTags() {
  const res = await request("GET", "/admin/tags");
  expect(res.status).toBe(200);
  return z.array(adminTagSchema).parse(res.body);
}

async function tagsOf(id: number) {
  return adminPostSchema.parse((await request("GET", `/admin/posts/${id}`)).body).tags;
}

async function searchSlugs(q: string) {
  const res = await request("GET", `/search?q=${encodeURIComponent(q)}`, { auth: false });
  return searchResultSchema.parse(res.body).items.map((hit) => hit.slug);
}

describe("GET / POST /admin/tags", () => {
  it("requires an admin session", async () => {
    expect((await request("GET", "/admin/tags", { auth: false })).status).toBe(401);
    expect((await request("POST", "/admin/tags", { auth: false, body: { slug: "x", name: "x" } })).status).toBe(401);
  });

  it("lists every tag with total and published usage, most used first", async () => {
    await createTag({ slug: "unused", name: "没人用" });
    await createTag({ slug: "css", name: "CSS", translations: { en: "CSS", ja: "CSS" } });
    await createTag({ slug: "design", name: "设计", translations: { en: "Design", ja: "デザイン" } });
    await createPost({ slug: "p1", tags: ["design", "css"], ...published });
    await createPost({ slug: "p2", tags: ["design"] });

    expect(await listTags()).toEqual([
      { id: 3, slug: "design", name: "设计", translations: { en: "Design", ja: "デザイン" }, postCount: 2, publishedCount: 1 },
      { id: 2, slug: "css", name: "CSS", translations: { en: "CSS", ja: "CSS" }, postCount: 1, publishedCount: 1 },
      { id: 1, slug: "unused", name: "没人用", translations: { en: "没人用 (en)", ja: "没人用 (ja)" }, postCount: 0, publishedCount: 0 },
    ]);
  });

  it("creates a tag with trimmed names", async () => {
    const res = await request("POST", "/admin/tags", { body: { slug: "frontend", name: "  前端 ", translations: { en: " Frontend", ja: "フロントエンド " } } });
    expect(res.status).toBe(201);
    expect(adminTagSchema.parse(res.body)).toEqual({
      id: 1,
      slug: "frontend",
      name: "前端",
      translations: { en: "Frontend", ja: "フロントエンド" },
      postCount: 0,
      publishedCount: 0,
    });
  });

  it.each([
    ["no translations", {}, "translations"],
    ["a missing language", { translations: { en: "Frontend" } }, "translations.ja"],
    ["a blank translation", { translations: { en: "Frontend", ja: "  " } }, "translations.ja"],
    ["the original language as a translation", { translations: { zh: "前端", en: "Frontend", ja: "フロントエンド" } }, "translations.zh"],
  ])("requires a name in every other language: refuses %s", async (_name, extra, path) => {
    const res = await request("POST", "/admin/tags", { body: { slug: "frontend", name: "前端", ...extra } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "validation_error", issues: [{ path }] } });
    expect(await listTags()).toEqual([]);
  });

  const both = (en: string, ja: string) => ({ translations: { en, ja } });
  it.each([
    ["the same slug", { slug: "css", name: "层叠样式表", ...both("Cascading", "カスケード") }, "已经有使用这个 slug 的标签"],
    ["the same name in another case", { slug: "css-2", name: "css", ...both("Cascading", "カスケード") }, "已经有同名的标签"],
    ["a translated name another tag already has in that language", { slug: "css-2", name: "样式", ...both("Css", "スタイル") }, "这种语言里已经有同名的标签"],
  ])("refuses %s with 409", async (_name, body, message) => {
    await createTag({ slug: "css", name: "CSS", translations: { en: "CSS", ja: "CSS" } });
    const res = await request("POST", "/admin/tags", { body });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: "conflict", message } });
  });

  it.each([
    ["an invalid slug", { slug: "Not A Slug", name: "x" }],
    ["a blank name", { slug: "x", name: "   " }],
    ["an unknown field", { slug: "x", name: "x", count: 3 }],
  ])("rejects %s", async (_name, body) => {
    expect((await request("POST", "/admin/tags", { body })).status).toBe(400);
  });
});

describe("PATCH /admin/tags/:id", () => {
  it("renames a tag everywhere, reindexes its posts and refreshes published pages", async () => {
    const tag = await createTag({ slug: "web", name: "网页" });
    const live = await createPost({ slug: "live", contentMd: "甲", tags: ["web"], ...published });
    const draft = await createPost({ slug: "draft", contentMd: "乙", tags: ["web"] });
    const [before] = await db.select({ updatedAt: posts.updatedAt }).from(posts).where(eq(posts.id, live.id));
    revalidations.length = 0;

    const res = await request("PATCH", `/admin/tags/${tag.id}`, { body: { name: "前端" } });
    expect(res.status).toBe(200);
    expect(adminTagSchema.parse(res.body)).toMatchObject({ name: "前端", postCount: 2, publishedCount: 1 });

    expect(await tagsOf(draft.id)).toEqual([{ slug: "web", name: "前端" }]);
    expect(await searchSlugs("网页")).toEqual([]);
    expect(await searchSlugs("前端")).toEqual(["live"]);
    // 草稿的页面前台看不到，不用刷新
    expect(revalidations).toEqual([tagsForPublishedPosts(["live"])]);
    // 重建索引不算作者的编辑
    const [after] = await db.select({ updatedAt: posts.updatedAt }).from(posts).where(eq(posts.id, live.id));
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("replaces the translated names and refreshes the published pages that show them", async () => {
    const tag = await createTag({ slug: "web", name: "网页", translations: { en: "Web", ja: "ウェブ" } });
    const post = await createPost({ slug: "p", tags: ["web"], ...published });
    revalidations.length = 0;

    const res = await request("PATCH", `/admin/tags/${tag.id}`, { body: { translations: { en: "Webpage", ja: "ウェブ" } } });
    expect(adminTagSchema.parse(res.body).translations).toEqual({ en: "Webpage", ja: "ウェブ" });
    expect(revalidations).toEqual([tagsForPublishedPosts(["p"])]);
    expect((await request("GET", `/posts/p?locale=en`, { auth: false })).body).toMatchObject({ tags: [{ slug: "web", name: "Webpage" }] });
    // 后台的文章数据用原文名称
    expect(await tagsOf(post.id)).toEqual([{ slug: "web", name: "网页" }]);

    // 同样的译名再存一次：什么都没变，不刷新
    revalidations.length = 0;
    await request("PATCH", `/admin/tags/${tag.id}`, { body: { translations: { en: "Webpage", ja: "ウェブ" } } });
    expect(revalidations).toEqual([]);
    // 给了译名就要给全
    expect((await request("PATCH", `/admin/tags/${tag.id}`, { body: { translations: { en: "Web" } } })).status).toBe(400);
  });

  it("gives an old tag its first translations through an edit", async () => {
    const [legacy] = await db.insert(tags).values({ slug: "legacy", name: "旧标签" }).returning({ id: tags.id });
    expect((await listTags())[0]?.translations).toEqual({});
    const res = await request("PATCH", `/admin/tags/${legacy?.id}`, { body: { name: "旧标签", translations: { en: "Legacy", ja: "レガシー" } } });
    expect(adminTagSchema.parse(res.body).translations).toEqual({ en: "Legacy", ja: "レガシー" });
  });

  it("changes the slug that posts reference", async () => {
    const tag = await createTag({ slug: "js", name: "JavaScript" });
    const post = await createPost({ slug: "p", tags: ["js"], ...published });
    revalidations.length = 0;

    await request("PATCH", `/admin/tags/${tag.id}`, { body: { slug: "javascript" } });
    expect(await tagsOf(post.id)).toEqual([{ slug: "javascript", name: "JavaScript" }]);
    expect(revalidations).toEqual([tagsForPublishedPosts(["p"])]);
    expect((await request("PATCH", `/admin/posts/${post.id}`, { body: { tags: ["js"] } })).status).toBe(400);
  });

  it("does not refresh anything when nothing changed", async () => {
    const tag = await createTag({ slug: "css", name: "CSS" });
    await createPost({ slug: "p", tags: ["css"], ...published });
    revalidations.length = 0;
    expect((await request("PATCH", `/admin/tags/${tag.id}`, { body: { name: "CSS" } })).status).toBe(200);
    expect(revalidations).toEqual([]);
  });

  it("refuses a name another tag already has, and 404s for a missing tag", async () => {
    await createTag({ slug: "a", name: "Alpha" });
    const b = await createTag({ slug: "b", name: "Beta" });
    expect((await request("PATCH", `/admin/tags/${b.id}`, { body: { name: "ALPHA" } })).status).toBe(409);
    expect((await request("PATCH", "/admin/tags/999", { body: { name: "x" } })).status).toBe(404);
    expect((await request("PATCH", `/admin/tags/${b.id}`, { body: {} })).status).toBe(400);
  });
});

describe("DELETE /admin/tags/:id", () => {
  it("removes the tag from its posts and refreshes them", async () => {
    await createTag({ slug: "keep", name: "保留" });
    const gone = await createTag({ slug: "gone", name: "删掉的标签" });
    const post = await createPost({ slug: "p", tags: ["gone", "keep"], ...published });
    revalidations.length = 0;

    expect((await request("DELETE", `/admin/tags/${gone.id}`)).status).toBe(204);
    expect(await tagsOf(post.id)).toEqual([{ slug: "keep", name: "保留" }]);
    expect(await searchSlugs("删掉的标签")).toEqual([]);
    expect(revalidations).toEqual([tagsForPublishedPosts(["p"])]);
    expect((await listTags()).map((t) => t.slug)).toEqual(["keep"]);
    expect((await request("DELETE", `/admin/tags/${gone.id}`)).status).toBe(404);
  });

  it("does not refresh anything for an unused tag", async () => {
    const tag = await createTag({ slug: "unused" });
    revalidations.length = 0;
    expect((await request("DELETE", `/admin/tags/${tag.id}`)).status).toBe(204);
    expect(revalidations).toEqual([]);
  });
});

describe("POST /admin/tags/:id/merge", () => {
  it("moves posts to the target tag in place, without duplicates", async () => {
    const source = await createTag({ slug: "frontend-dev", name: "前端开发" });
    const target = await createTag({ slug: "frontend", name: "前端" });
    await createTag({ slug: "css", name: "CSS" });
    const onlySource = await createPost({ slug: "only", tags: ["css", "frontend-dev"], ...published });
    const both = await createPost({ slug: "both", tags: ["frontend", "frontend-dev"] });
    const untouched = await createPost({ slug: "untouched", tags: ["css"], ...published });
    revalidations.length = 0;

    const res = await request("POST", `/admin/tags/${source.id}/merge`, { body: { into: target.id } });
    expect(res.status).toBe(200);
    expect(adminTagSchema.parse(res.body)).toMatchObject({ id: target.id, postCount: 2, publishedCount: 1 });

    expect(await tagsOf(onlySource.id)).toEqual([
      { slug: "css", name: "CSS" },
      { slug: "frontend", name: "前端" },
    ]);
    expect(await tagsOf(both.id)).toEqual([{ slug: "frontend", name: "前端" }]);
    expect(await tagsOf(untouched.id)).toEqual([{ slug: "css", name: "CSS" }]);
    expect((await listTags()).map((t) => t.slug).sort()).toEqual(["css", "frontend"]);
    expect(await searchSlugs("前端开发")).toEqual([]);
    expect(await searchSlugs("前端")).toEqual(["only"]);
    expect(revalidations).toEqual([tagsForPublishedPosts(["only"])]);
  });

  it.each([
    ["into itself", (a: number) => ({ id: a, into: a }), 400],
    ["a missing tag", (a: number) => ({ id: 999, into: a }), 404],
    ["into a missing tag", (a: number) => ({ id: a, into: 999 }), 404],
  ])("refuses to merge %s", async (_name, ids, status) => {
    const tag = await createTag({ slug: "a" });
    const { id, into } = ids(tag.id);
    expect((await request("POST", `/admin/tags/${id}/merge`, { body: { into } })).status).toBe(status);
    expect(await listTags()).toHaveLength(1);
  });
});

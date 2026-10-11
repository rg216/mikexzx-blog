import { publicPostSchema, postSummaryPageSchema, tagWithCountSchema } from "@blog/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { posts, postTranslations } from "../src/db/schema.ts";
import { setupTestApp } from "./helpers.ts";

const { db, request, createPost, translatePost } = setupTestApp();

const listIn = async (locale: string) => postSummaryPageSchema.parse((await request("GET", `/posts?locale=${locale}`, { auth: false })).body).items;
const postIn = async (slug: string, locale: string) => publicPostSchema.parse((await request("GET", `/posts/${slug}?locale=${locale}`, { auth: false })).body);
const tagsIn = async (locale: string) => z.array(tagWithCountSchema).parse((await request("GET", `/tags?locale=${locale}`, { auth: false })).body);

describe("GET /posts", () => {
  it("lists only published posts, newest first, matching the shared schema", async () => {
    await createPost({ slug: "old", status: "published", publishedAt: "2026-01-01T00:00:00Z" });
    await createPost({ slug: "draft", status: "draft" });
    await createPost({ slug: "new", status: "published", publishedAt: "2026-02-01T00:00:00Z" });

    const res = await request("GET", "/posts", { auth: false });
    expect(res.status).toBe(200);
    const page = postSummaryPageSchema.parse(res.body);
    expect(page.items.map((p) => p.slug)).toEqual(["new", "old"]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).not.toHaveProperty("contentMd");
  });

  it("paginates with a cursor without skipping or repeating posts", async () => {
    // 两篇发布时间相同：验证游标用 id 打破平局
    for (const [slug, publishedAt] of [
      ["a", "2026-01-05T00:00:00Z"],
      ["b", "2026-01-04T00:00:00Z"],
      ["c", "2026-01-04T00:00:00Z"],
      ["d", "2026-01-02T00:00:00Z"],
      ["e", "2026-01-01T00:00:00Z"],
    ] as const) {
      await createPost({ slug, status: "published", publishedAt });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : "?limit=2";
      const page = postSummaryPageSchema.parse((await request("GET", `/posts${query}`, { auth: false })).body);
      seen.push(...page.items.map((p) => p.slug));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual(["a", "c", "b", "d", "e"]);
  });

  it.each([["?limit=0"], ["?limit=51"], ["?limit=abc"], ["?cursor=not-a-cursor"]])("rejects %s with 400", async (query) => {
    const res = await request("GET", `/posts${query}`, { auth: false });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "validation_error" } });
  });
});

describe("GET /posts/:slug", () => {
  it("returns a published post with content and tags in author order", async () => {
    await createPost({
      slug: "hello",
      status: "published",
      contentMd: "第一段。\n\n第二段。",
      tags: [
        { slug: "zeta", name: "Z" },
        { slug: "alpha", name: "A" },
      ],
    });

    const res = await request("GET", "/posts/hello", { auth: false });
    expect(res.status).toBe(200);
    const post = publicPostSchema.parse(res.body);
    // 不带 ?locale= 时是默认语言（中文原文），兼容旧前端
    expect(post).toMatchObject({ locale: "zh", sourceLocale: "zh", availableLocales: ["zh"], translation: null });
    expect(post.contentMd).toBe("第一段。\n\n第二段。");
    expect(post.excerpt).toBe("第一段。第二段。");
    expect(post.tags.map((t) => t.slug)).toEqual(["zeta", "alpha"]);
  });

  it.each([
    ["a draft", "secret"],
    ["an unknown slug", "nope"],
    ["an invalid slug", "Not_A_Slug"],
  ])("returns 404 for %s", async (_name, slug) => {
    await createPost({ slug: "secret", status: "draft" });
    const res = await request("GET", `/posts/${slug}`, { auth: false });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("GET /tags", () => {
  it("counts published posts per tag, ignoring drafts", async () => {
    const fullstack = { slug: "fullstack", name: "全栈" };
    const design = { slug: "design", name: "设计" };
    await createPost({ slug: "p1", status: "published", tags: [fullstack, design] });
    await createPost({ slug: "p2", status: "published", tags: [fullstack] });
    await createPost({ slug: "d1", status: "draft", tags: [fullstack, { slug: "secret", name: "秘密" }] });

    const res = await request("GET", "/tags", { auth: false });
    expect(z.array(tagWithCountSchema).parse(res.body)).toEqual([
      { ...fullstack, count: 2 },
      { ...design, count: 1 },
    ]);
  });
});

describe("languages", () => {
  it("lists a post in another language only when it has a translation there, showing the translated title and excerpt", async () => {
    const a = await createPost({ slug: "a", title: "甲", contentMd: "甲的正文。", status: "published", publishedAt: "2026-01-02T00:00:00Z" });
    await createPost({ slug: "b", title: "乙", contentMd: "乙的正文。", status: "published", publishedAt: "2026-01-01T00:00:00Z" });
    await translatePost(a.id, "en", { title: "A", contentMd: "Body of A." });

    expect(await listIn("en")).toEqual([expect.objectContaining({ slug: "a", title: "A", excerpt: "Body of A.", locale: "en" })]);
    expect(await listIn("ja")).toEqual([]);
    // 中文列表不受译文影响：两篇都在，内容是原文
    expect((await listIn("zh")).map((p) => [p.slug, p.title, p.excerpt, p.locale])).toEqual([
      ["a", "甲", "甲的正文。", "zh"],
      ["b", "乙", "乙的正文。", "zh"],
    ]);
  });

  it("paginates a language's list over translated posts only", async () => {
    for (const [i, slug] of ["a", "b", "c", "d", "e"].entries()) {
      const post = await createPost({ slug, status: "published", publishedAt: `2026-01-0${9 - i}T00:00:00Z` });
      if (slug !== "c") await translatePost(post.id, "ja");
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${cursor}` : "";
      const page = postSummaryPageSchema.parse((await request("GET", `/posts?locale=ja&limit=2${query}`, { auth: false })).body);
      seen.push(...page.items.map((p) => p.slug));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["a", "b", "d", "e"]);
  });

  it("never shows translations of drafts", async () => {
    const draft = await createPost({ slug: "draft" });
    await translatePost(draft.id, "en");
    expect(await listIn("en")).toEqual([]);
    expect((await request("GET", "/posts/draft?locale=en", { auth: false })).status).toBe(404);
    expect(await tagsIn("en")).toEqual([]);
  });

  it("returns the translation of a post with its translation status and available languages", async () => {
    const { id } = await createPost({ slug: "a", title: "标题", contentMd: "正文。", status: "published", tags: [{ slug: "t", name: "标签" }] });
    await translatePost(id, "ja", { title: "タイトル", contentMd: "本文。" });

    const post = await postIn("a", "ja");
    expect(post).toMatchObject({
      slug: "a",
      locale: "ja",
      sourceLocale: "zh",
      title: "タイトル",
      contentMd: "本文。",
      excerpt: "本文。",
      availableLocales: ["zh", "ja"],
      translation: { origin: "human", outdated: false },
      // 标签不翻译
      tags: [{ slug: "t", name: "标签" }],
    });
  });

  it("falls back to the original when the language has no translation", async () => {
    const { id } = await createPost({ slug: "a", title: "标题", contentMd: "正文。", status: "published" });
    await translatePost(id, "ja");

    const post = await postIn("a", "en");
    expect(post).toMatchObject({ locale: "zh", title: "标题", contentMd: "正文。", translation: null, availableLocales: ["zh", "ja"] });
    // 请求原文语言本身
    expect(await postIn("a", "zh")).toMatchObject({ locale: "zh", title: "标题", translation: null });
  });

  it("tells readers when the original changed after the translation", async () => {
    const { id } = await createPost({ slug: "a", status: "published" });
    await translatePost(id, "en");
    expect((await postIn("a", "en")).translation?.outdated).toBe(false);
    await request("PATCH", `/admin/posts/${id}`, { body: { title: "新标题" } });
    expect((await postIn("a", "en")).translation?.outdated).toBe(true);
  });

  it("counts tags per language, only over posts visible in it", async () => {
    const shared = { slug: "shared", name: "共用" };
    const a = await createPost({ slug: "a", status: "published", tags: [shared, { slug: "only-a", name: "甲" }] });
    await createPost({ slug: "b", status: "published", tags: [shared, { slug: "only-b", name: "乙" }] });
    await translatePost(a.id, "en");

    expect(await tagsIn("en")).toEqual([
      { ...shared, count: 1 },
      { slug: "only-a", name: "甲", count: 1 },
    ]);
    expect((await tagsIn("zh")).find((t) => t.slug === "shared")?.count).toBe(2);
    expect(await tagsIn("ja")).toEqual([]);
  });

  it("does not assume the original is Chinese", async () => {
    // 预留的 source_locale：原文是英文的文章出现在英文列表，中文列表只在有中文译文时才有它
    const { id } = await createPost({ slug: "a", title: "Hello", contentMd: "English original.", status: "published" });
    await db.update(posts).set({ sourceLocale: "en" }).where(eq(posts.id, id));

    expect((await listIn("en")).map((p) => [p.title, p.locale])).toEqual([["Hello", "en"]]);
    expect(await listIn("zh")).toEqual([]);
    expect(await postIn("a", "zh")).toMatchObject({ locale: "en", sourceLocale: "en", translation: null, availableLocales: ["en"] });

    await translatePost(id, "zh", { title: "你好", contentMd: "中文译文。" });
    expect((await listIn("zh")).map((p) => [p.title, p.locale])).toEqual([["你好", "zh"]]);
    expect(await postIn("a", "zh")).toMatchObject({ locale: "zh", title: "你好", availableLocales: ["zh", "en"] });
    // 原文语言不能再加"译文"
    expect((await request("PUT", `/admin/posts/${id}/translations/en`, { body: { title: "x", contentMd: "x", sourceHash: "0".repeat(64) } })).status).toBe(400);
  });

  it("always shows the original in its own language, even if a same-language translation slipped into the database", async () => {
    // API 拒绝为原文语言保存译文；这里直接写库，验证查询本身也不会让这种行取代原文
    const { id } = await createPost({ slug: "a", title: "原文标题", status: "published", tags: [{ slug: "t", name: "T" }] });
    await db.insert(postTranslations).values({ postId: id, locale: "zh", title: "冒牌", contentMd: "x", excerpt: "x", sourceHash: "0".repeat(64), origin: "human" });
    expect((await listIn("zh")).map((p) => p.title)).toEqual(["原文标题"]);
    expect(await postIn("a", "zh")).toMatchObject({ title: "原文标题", translation: null });
    expect(await tagsIn("zh")).toEqual([{ slug: "t", name: "T", count: 1 }]);
  });

  it.each([["/posts?locale=fr"], ["/posts/a?locale=fr"], ["/tags?locale=fr"], ["/posts?locale=zh-CN"], ["/posts?locale="]])(
    "rejects an unsupported language: %s",
    async (path) => {
      await createPost({ slug: "a", status: "published" });
      const res = await request("GET", path, { auth: false });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "validation_error" } });
    },
  );
});

describe("misc", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request("GET", "/nope", { auth: false });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
  });

  it("sets security headers", async () => {
    const res = await request("GET", "/health", { auth: false });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

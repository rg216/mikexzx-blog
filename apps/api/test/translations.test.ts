import { adminPostSchema, adminTranslationSchema } from "@blog/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { postTranslations } from "../src/db/schema.ts";
import { sourceHash } from "../src/lib/source-hash.ts";
import { setupTestApp } from "./helpers.ts";

const { db, request, createPost, translatePost, revalidations } = setupTestApp();

const getPost = async (id: number) => adminPostSchema.parse((await request("GET", `/admin/posts/${id}`)).body);
const put = (id: number, locale: string, body: unknown, options: { auth?: boolean; origin?: string | null } = {}) =>
  request("PUT", `/admin/posts/${id}/translations/${locale}`, { body, ...options });

describe("PUT /admin/posts/:id/translations/:locale", () => {
  it("creates a human translation (201), then replaces it (200)", async () => {
    const { id } = await createPost({ slug: "a", title: "标题", contentMd: "正文。" });
    const { sourceHash: hash } = await getPost(id);

    const before = Date.now();
    const created = await put(id, "en", { title: "  Title  ", contentMd: "# Heading\n\nBody text.", sourceHash: hash });
    expect(created.status).toBe(201);
    const createdAt = Date.parse(adminTranslationSchema.parse(created.body).translatedAt);
    expect(createdAt).toBeGreaterThanOrEqual(before - 1000);
    expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000);
    expect(adminTranslationSchema.parse(created.body)).toMatchObject({
      locale: "en",
      title: "Title",
      contentMd: "# Heading\n\nBody text.",
      excerpt: "Body text.",
      origin: "human",
      model: null,
      sourceHash: hash,
      outdated: false,
    });

    // 把保存时间改到很久以前，再替换：translatedAt 要刷新为这次保存的时间（不用等待或假时钟）
    await db.update(postTranslations).set({ translatedAt: new Date("2020-01-01T00:00:00Z") });
    const replaced = await put(id, "en", { title: "Title 2", contentMd: "New body.", sourceHash: hash });
    expect(replaced.status).toBe(200);
    const replacedBody = adminTranslationSchema.parse(replaced.body);
    expect(replacedBody).toMatchObject({ title: "Title 2", excerpt: "New body." });
    expect(Date.parse(replacedBody.translatedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(await db.select().from(postTranslations)).toHaveLength(1);
  });

  it("makes the excerpt as long as the language needs, without cutting English words in half", async () => {
    const { id } = await createPost({ slug: "a" });
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const res = await translatePost(id, "en", { contentMd: words });
    const { excerpt } = adminTranslationSchema.parse(res.body);
    // 英文摘要 240 个字素（中文是 120），截断处退回到单词之间
    expect(excerpt.length).toBeGreaterThan(200);
    expect(excerpt.length).toBeLessThanOrEqual(241);
    expect(words.startsWith(excerpt.slice(0, -1))).toBe(true);
    expect(excerpt).toMatch(/word\d+…$/);
    expect(words.charAt(excerpt.length - 1)).toBe(" ");
  });

  it("refuses a translation into the post's own language", async () => {
    const { id } = await createPost({ slug: "a" });
    const res = await put(id, "zh", { title: "x", contentMd: "x", sourceHash: (await getPost(id)).sourceHash });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "validation_error" } });
  });

  it("answers 404 for a missing post", async () => {
    const res = await put(999, "en", { title: "x", contentMd: "x", sourceHash: "0".repeat(64) });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
  });

  it.each([
    ["an unsupported language", "fr", { title: "x", contentMd: "x", sourceHash: "0".repeat(64) }],
    ["a language tag in the wrong case", "EN", { title: "x", contentMd: "x", sourceHash: "0".repeat(64) }],
    ["a missing source hash", "en", { title: "x", contentMd: "x" }],
    ["a malformed source hash", "en", { title: "x", contentMd: "x", sourceHash: "abc" }],
    ["a blank title", "en", { title: "  ", contentMd: "x", sourceHash: "0".repeat(64) }],
    ["unknown fields", "en", { title: "x", contentMd: "x", sourceHash: "0".repeat(64), origin: "machine" }],
  ])("rejects %s with 400", async (_name, locale, body) => {
    const { id } = await createPost({ slug: "a" });
    const res = await put(id, locale, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "validation_error" } });
  });

  it("requires an admin session and a same-origin request", async () => {
    const { id } = await createPost({ slug: "a" });
    const body = { title: "x", contentMd: "x", sourceHash: (await getPost(id)).sourceHash };
    expect((await put(id, "en", body, { auth: false })).status).toBe(401);
    expect((await put(id, "en", body, { origin: "https://evil.test" })).status).toBe(403);
    expect((await request("GET", `/admin/posts/${id}/translations/en`, { auth: false })).status).toBe(401);
    expect((await request("DELETE", `/admin/posts/${id}/translations/en`, { auth: false })).status).toBe(401);
    expect(await db.select().from(postTranslations)).toHaveLength(0);
  });
});

describe("GET / DELETE /admin/posts/:id/translations/:locale", () => {
  it("returns a saved translation, 404 when there is none", async () => {
    const { id } = await createPost({ slug: "a" });
    await translatePost(id, "ja", { title: "タイトル", contentMd: "本文です。" });

    const res = await request("GET", `/admin/posts/${id}/translations/ja`);
    expect(res.status).toBe(200);
    expect(adminTranslationSchema.parse(res.body)).toMatchObject({ locale: "ja", title: "タイトル", contentMd: "本文です。" });
    expect((await request("GET", `/admin/posts/${id}/translations/en`)).status).toBe(404);
    expect((await request("GET", `/admin/posts/999/translations/en`)).status).toBe(404);
    expect((await request("GET", `/admin/posts/${id}/translations/fr`)).status).toBe(400);
  });

  it("deletes a translation (204), then 404s", async () => {
    const { id } = await createPost({ slug: "a" });
    await translatePost(id, "en");
    const res = await request("DELETE", `/admin/posts/${id}/translations/en`);
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect((await request("GET", `/admin/posts/${id}/translations/en`)).status).toBe(404);
    expect((await request("DELETE", `/admin/posts/${id}/translations/en`)).status).toBe(404);
    expect((await request("DELETE", `/admin/posts/999/translations/en`)).status).toBe(404);
  });

  it("deletes the translations together with the post", async () => {
    const { id } = await createPost({ slug: "a" });
    await translatePost(id, "en");
    await translatePost(id, "ja");
    await request("DELETE", `/admin/posts/${id}`);
    expect(await db.select().from(postTranslations).where(eq(postTranslations.postId, id))).toEqual([]);
  });
});

describe("translations on the admin post", () => {
  it("includes the source language, the source hash and translation summaries in language order", async () => {
    const { id } = await createPost({ slug: "a", title: "标题", contentMd: "正文。" });
    // 先日文后英文：返回时仍按 locales 的顺序（en 在 ja 前）
    await translatePost(id, "ja");
    await translatePost(id, "en");

    const post = await getPost(id);
    expect(post.sourceLocale).toBe("zh");
    expect(post.locale).toBe("zh");
    expect(post.sourceHash).toBe(sourceHash({ title: "标题", contentMd: "正文。" }));
    expect(post.translations.map((t) => t.locale)).toEqual(["en", "ja"]);
    expect(post.translations[0]).not.toHaveProperty("contentMd");

    const [listed] = z.array(adminPostSchema).parse((await request("GET", "/admin/posts")).body);
    expect(listed?.translations.map((t) => t.locale)).toEqual(["en", "ja"]);
  });

  it("marks translations outdated when the original changes, and current again once re-saved against it", async () => {
    const { id } = await createPost({ slug: "a", title: "标题", contentMd: "正文。" });
    await translatePost(id, "en");
    await translatePost(id, "ja");

    // 标签、slug、状态不影响译文内容，不算原文更新
    await request("PATCH", `/admin/posts/${id}`, { body: { tags: [{ slug: "t", name: "T" }], slug: "b", status: "published" } });
    expect((await getPost(id)).translations.map((t) => t.outdated)).toEqual([false, false]);

    await request("PATCH", `/admin/posts/${id}`, { body: { contentMd: "改过的正文。" } });
    expect((await getPost(id)).translations.map((t) => t.outdated)).toEqual([true, true]);
    const translation = adminTranslationSchema.parse((await request("GET", `/admin/posts/${id}/translations/en`)).body);
    expect(translation.outdated).toBe(true);

    // 依据新原文保存英文译文：英文变为已同步，日文仍然过时
    await translatePost(id, "en", { contentMd: "Updated body." });
    expect((await getPost(id)).translations.map((t) => [t.locale, t.outdated])).toEqual([
      ["en", false],
      ["ja", true],
    ]);
  });

  it("keeps translatedAt when only the search index is rebuilt (tag change or rename)", async () => {
    const a = await createPost({ slug: "a", tags: [{ slug: "web", name: "Web" }] });
    await translatePost(a.id, "en");
    const old = new Date("2020-01-01T00:00:00Z");
    await db.update(postTranslations).set({ translatedAt: old });

    await request("PATCH", `/admin/posts/${a.id}`, { body: { tags: [{ slug: "web", name: "Web" }, { slug: "css", name: "CSS" }] } });
    // 另一篇文章把共用的标签改名：a 的译文索引跟着重建
    await createPost({ slug: "b", tags: [{ slug: "web", name: "Frontend" }] });
    const [row] = await db.select({ translatedAt: postTranslations.translatedAt }).from(postTranslations);
    expect(row?.translatedAt.toISOString()).toBe(old.toISOString());
  });

  it("stays outdated when saved against an older version of the original", async () => {
    const { id } = await createPost({ slug: "a", title: "标题", contentMd: "正文。" });
    const stale = (await getPost(id)).sourceHash;
    // 编辑译文期间原文被改了：译文依据的仍是旧原文
    await request("PATCH", `/admin/posts/${id}`, { body: { title: "新标题" } });
    const res = await put(id, "en", { title: "Title", contentMd: "Body.", sourceHash: stale });
    expect(adminTranslationSchema.parse(res.body).outdated).toBe(true);
  });
});

describe("revalidating translated pages", () => {
  it("does not notify for translations of drafts", async () => {
    const { id } = await createPost({ slug: "a" });
    await translatePost(id, "en");
    await translatePost(id, "en", { title: "again" });
    await request("DELETE", `/admin/posts/${id}/translations/en`);
    expect(revalidations).toEqual([]);
  });

  it("refreshes that language, plus the other languages' pages when a translation appears or disappears", async () => {
    const { id } = await createPost({ slug: "a", status: "published" });
    revalidations.length = 0;

    await translatePost(id, "en");
    await translatePost(id, "en", { title: "edited" });
    await request("DELETE", `/admin/posts/${id}/translations/en`);

    expect(revalidations).toEqual([
      ["posts:en", "post:a:en", "post:a:zh", "post:a:ja"], // 新增：其他语言的 hreflang、切换语言菜单变了
      ["posts:en", "post:a:en"], // 修改：只影响英文
      ["posts:en", "post:a:en", "post:a:zh", "post:a:ja"], // 删除
    ]);
  });

  it("does not notify when the write fails", async () => {
    const { id } = await createPost({ slug: "a", status: "published" });
    revalidations.length = 0;
    await put(id, "zh", { title: "x", contentMd: "x", sourceHash: (await getPost(id)).sourceHash });
    await request("DELETE", `/admin/posts/${id}/translations/en`);
    expect(revalidations).toEqual([]);
  });
});

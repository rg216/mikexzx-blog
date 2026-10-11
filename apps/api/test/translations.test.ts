import { adminPostSchema, adminTranslationSchema, apiErrorSchema } from "@blog/shared";
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

describe("saving machine translations (v5.5)", () => {
  const source = "介绍见[文档](https://hono.dev)。\n\n![架构图](https://img.test/a.png#small)\n\n```ts\nconst app = new Hono();\n```\n";
  const faithful = "See the [docs](https://hono.dev).\n\n![Architecture](https://img.test/a.png#small)\n\n```ts\nconst app = new Hono();\n```\n";

  it("stores an unedited machine translation as origin machine with the serving model", async () => {
    const { id } = await createPost({ slug: "a", contentMd: source });
    const { sourceHash: hash } = await getPost(id);
    const res = await put(id, "en", { title: "Intro", contentMd: faithful, sourceHash: hash, generated: { model: "claude-sonnet-5-5" } });
    expect(res.status).toBe(201);
    expect(adminTranslationSchema.parse(res.body)).toMatchObject({ origin: "machine", model: "claude-sonnet-5-5" });
    const [row] = await db.select().from(postTranslations).where(eq(postTranslations.postId, id));
    expect(row).toMatchObject({ origin: "machine", model: "claude-sonnet-5-5" });

    // 之后作者改过再保存（不带 generated）→ 人工译文，model 清空
    const edited = await put(id, "en", { title: "Intro", contentMd: `${faithful}\nEdited.`, sourceHash: hash });
    expect(edited.status).toBe(200);
    expect(adminTranslationSchema.parse(edited.body)).toMatchObject({ origin: "human", model: null });
  });

  it("refuses a machine translation whose structure differs from the source, listing every problem, and saves nothing", async () => {
    const { id } = await createPost({ slug: "a", contentMd: source });
    const { sourceHash: hash } = await getPost(id);
    const broken = "See the [docs](https://hono.dev/ja).\n\n![Architecture](https://img.test/a.png)\n\n```ts\nconst app = new Hono() // translated\n```\n";
    const res = await put(id, "en", { title: "Intro", contentMd: broken, sourceHash: hash, generated: { model: "claude-sonnet-5-5" } });
    expect(res.status).toBe(400);
    const { error } = apiErrorSchema.parse(res.body);
    expect(error.code).toBe("validation_error");
    expect(error.message).toContain("机器译文的结构与原文不一致");
    const messages = (error.issues ?? []).map((issue) => issue.message);
    expect(error.issues?.every((issue) => issue.path === "contentMd")).toBe(true);
    expect(messages.some((m) => m.includes("代码块的内容被改动"))).toBe(true);
    // 方向要对：缺的是原文的地址，多的是译文的地址
    expect(messages).toContain("译文缺少图片（或图片地址被改动）：https://img.test/a.png#small");
    expect(messages).toContain("译文多出图片地址：https://img.test/a.png");
    expect(messages).toContain("译文缺少链接（或链接地址被改动）：https://hono.dev");
    expect(messages).toContain("译文多出链接地址：https://hono.dev/ja");
    expect(await db.select().from(postTranslations)).toHaveLength(0);
  });

  it("refuses (409) a machine translation made for an older version of the source, but still saves a human one as outdated", async () => {
    const { id } = await createPost({ slug: "a", contentMd: source });
    const { sourceHash: oldHash } = await getPost(id);
    // 编辑器打开之后，原文在另一个标签页里改了一个链接地址
    await request("PATCH", `/admin/posts/${id}`, { body: { contentMd: source.replace("https://hono.dev", "https://hono.dev/docs") } });

    const machine = await put(id, "en", { title: "Intro", contentMd: faithful, sourceHash: oldHash, generated: { model: "claude-sonnet-5-5" } });
    expect(machine.status).toBe(409);
    expect(machine.body).toEqual({ error: { code: "conflict", message: "原文已更新，请载入最新原文后重新生成" } });
    expect(await db.select().from(postTranslations)).toHaveLength(0);

    const human = await put(id, "en", { title: "Intro", contentMd: faithful, sourceHash: oldHash });
    expect(human.status).toBe(201);
    expect(adminTranslationSchema.parse(human.body)).toMatchObject({ origin: "human", sourceHash: oldHash, outdated: true });
  });

  it("lets the author save the same text as a human translation", async () => {
    const { id } = await createPost({ slug: "a", contentMd: source });
    const { sourceHash: hash } = await getPost(id);
    const res = await put(id, "en", { title: "Intro", contentMd: "No code, no links.", sourceHash: hash });
    expect(res.status).toBe(201);
    expect(adminTranslationSchema.parse(res.body)).toMatchObject({ origin: "human", model: null });
  });

  it("does not block machine translations on warnings (e.g. a merged paragraph)", async () => {
    const { id } = await createPost({ slug: "a", contentMd: "第一段。\n\n第二段。\n\n第三段。\n\n第四段。" });
    const { sourceHash: hash } = await getPost(id);
    const res = await put(id, "ja", { title: "T", contentMd: "第一段。第二段。第三段。第四段。", sourceHash: hash, generated: { model: "m" } });
    expect(res.status).toBe(201);
    expect(adminTranslationSchema.parse(res.body)).toMatchObject({ origin: "machine", model: "m" });
  });
});

describe("LLM translation without ANTHROPIC_API_KEY", () => {
  it("reports translation as unavailable and answers generate requests with 503", async () => {
    expect((await request("GET", "/admin/translation/config")).body).toEqual({ available: false, model: "claude-sonnet-5-5", reason: "not_configured" });
    const { id } = await createPost({ slug: "a" });
    const res = await request("POST", `/admin/posts/${id}/translations/en/generate`, {
      body: { part: "title", sourceHash: (await getPost(id)).sourceHash },
    });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: "internal_error", message: "翻译功能未启用（服务器需要设置 ANTHROPIC_API_KEY 和 REDIS_URL）" } });
  });
});

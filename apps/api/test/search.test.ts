import { SEARCH_RESULT_LIMIT, searchResultSchema } from "@blog/shared";
import { eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.ts";
import { posts, postTranslations } from "../src/db/schema.ts";
import { reindexPosts } from "../src/services/posts.ts";
import { reindexTranslations } from "../src/services/translations.ts";
import { setupTestApp } from "./helpers.ts";

const { db, request, createPost, createTag, translatePost } = setupTestApp();

async function search(q: string, locale?: string) {
  const res = await request("GET", `/search?q=${encodeURIComponent(q)}${locale ? `&locale=${locale}` : ""}`, { auth: false });
  expect(res.status).toBe(200);
  return searchResultSchema.parse(res.body).items;
}

const slugs = async (q: string, locale?: string) => (await search(q, locale)).map((hit) => hit.slug);
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
    await createTag({ slug: "typography", name: "排版" });
    await createPost({ slug: "tagged", contentMd: "正文", tags: ["typography"], ...published });
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

    await createTag({ slug: "t", name: "标签名" });
    await request("PATCH", `/admin/posts/${post.id}`, { body: { tags: ["t"] } });
    expect(await slugs("标签名")).toEqual(["edit"]);
    // 只改标签时标题仍然可搜（索引用的是库里的当前值）
    expect(await slugs("新标题")).toEqual(["edit"]);

    await request("PATCH", `/admin/posts/${post.id}`, { body: { title: "第三个标题" } });
    expect(await slugs("第三个")).toEqual(["edit"]);
    expect(await slugs("标签名 新内容")).toEqual(["edit"]);
  });

  it("cuts snippets at word boundaries with the per-language length", async () => {
    const post = await createPost({ slug: "long", title: "长文", contentMd: "中文正文。", ...published });
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    await translatePost(post.id, "en", { title: "Long", contentMd: `${words} needle ${words}` });
    const [hit] = await search("needle", "en");
    const text = hit?.snippet.text ?? "";
    // 英文摘要长度 240（中文是 120），两端都不切开单词
    expect(text.length).toBeGreaterThan(200);
    expect(text.replace(/^…|…$/g, "").split(" ").every((word) => /^word\d+$|^needle$/.test(word))).toBe(true);
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

describe("GET /search in other languages", () => {
  it("searches each language in its own index", async () => {
    const a = await createPost({ slug: "a", title: "缓存策略", contentMd: "关于缓存的文章。", ...published });
    await createPost({ slug: "b", title: "只有中文", contentMd: "没有译文的缓存文章。", ...published });
    await translatePost(a.id, "en", { title: "Caching strategies", contentMd: "Deploying caches at the edge." });
    await translatePost(a.id, "ja", { title: "キャッシュ戦略", contentMd: "エッジでキャッシュを使う。" });

    // 英文按词、前缀匹配
    expect(await slugs("caching", "en")).toEqual(["a"]);
    expect(await slugs("deploy", "en")).toEqual(["a"]);
    // 日文的假名、汉字按中日韩二元组切分
    expect(await slugs("キャッシュ", "ja")).toEqual(["a"]);
    expect(await slugs("戦略", "ja")).toEqual(["a"]);
    // 中文搜索不命中译文，其他语言也不命中只有中文的内容
    expect(await slugs("caching")).toEqual([]);
    expect(await slugs("caching", "zh")).toEqual([]);
    expect(await slugs("缓存", "en")).toEqual([]);
    expect(await slugs("caching", "ja")).toEqual([]);
    expect(await slugs("キャッシュ", "en")).toEqual([]);
    expect((await slugs("缓存")).sort()).toEqual(["a", "b"]);
  });

  it("returns highlights and snippets from the translation", async () => {
    const { id } = await createPost({ slug: "a", title: "标题", contentMd: "正文。", ...published });
    await translatePost(id, "en", { title: "Edge caching", contentMd: "We cache pages at the edge." });
    const [hit] = await search("edge", "en");
    expect(hit).toMatchObject({ slug: "a", locale: "en", title: { text: "Edge caching", highlights: [{ start: 0, end: 4 }] } });
    expect(hit?.snippet.text).toBe("We cache pages at the edge.");
  });

  it("finds translations by the post's tag names, which are not translated", async () => {
    await createTag({ slug: "css", name: "CSS" });
    await createTag({ slug: "layout", name: "Layout" });
    const { id } = await createPost({ slug: "a", contentMd: "正文", tags: ["css"], ...published });
    await translatePost(id, "en", { contentMd: "Body." });
    expect(await slugs("css", "en")).toEqual(["a"]);

    // 原文换了标签：译文的索引跟着重建
    await request("PATCH", `/admin/posts/${id}`, { body: { tags: ["layout"] } });
    expect(await slugs("css", "en")).toEqual([]);
    expect(await slugs("layout", "en")).toEqual(["a"]);
  });

  it("indexes each translation with that language's tag names", async () => {
    await createTag({ slug: "web", name: "网页", translations: { en: "Webpage", ja: "ウェブページ" } });
    const a = await createPost({ slug: "a", contentMd: "甲", tags: ["web"], ...published });
    await translatePost(a.id, "en", { contentMd: "A." });
    await translatePost(a.id, "ja", { contentMd: "エー。" });
    expect(await slugs("webpage", "en")).toEqual(["a"]);
    expect(await slugs("网页", "en")).toEqual([]);
    expect(await slugs("ウェブ", "ja")).toEqual(["a"]);
    expect(await slugs("网页")).toEqual(["a"]);
  });

  it("reindexes translations when a tag's translated name changes", async () => {
    const tag = await createTag({ slug: "web", name: "网页", translations: { en: "Webpage", ja: "ウェブページ" } });
    const a = await createPost({ slug: "a", contentMd: "甲", tags: ["web"], ...published });
    await translatePost(a.id, "en", { contentMd: "A." });
    await request("PATCH", `/admin/tags/${tag.id}`, { body: { translations: { en: "Frontend", ja: "ウェブページ" } } });
    expect(await slugs("webpage", "en")).toEqual([]);
    expect(await slugs("frontend", "en")).toEqual(["a"]);
  });

  it("ranks translated title matches above body matches and never returns drafts", async () => {
    const body = await createPost({ slug: "body", ...published, publishedAt: "2026-02-01T00:00:00Z" });
    const title = await createPost({ slug: "title", ...published, publishedAt: "2026-01-01T00:00:00Z" });
    const draft = await createPost({ slug: "draft" });
    await translatePost(body.id, "en", { title: "Notes", contentMd: "By the way, caching." });
    await translatePost(title.id, "en", { title: "Caching", contentMd: "Body." });
    await translatePost(draft.id, "en", { title: "Caching draft", contentMd: "Caching." });
    expect(await slugs("caching", "en")).toEqual(["title", "body"]);
  });

  it("backfills translations whose index is missing when migrations run", async () => {
    const { id } = await createPost({ slug: "a", ...published });
    await translatePost(id, "en", { contentMd: "Written before the migration." });
    await db.update(postTranslations).set({ searchVector: sql`NULL` });
    expect(await slugs("migration", "en")).toEqual([]);

    // 与 db:migrate 相同的入口（迁移本身已经全部执行过，这里只会跑迁移之后的补齐步骤）
    await runMigrations(process.env.TEST_DATABASE_URL ?? "");
    expect(await slugs("migration", "en")).toEqual(["a"]);
    expect(await reindexTranslations(db, isNull(postTranslations.searchVector))).toBe(0);
  });

  describe("merging originals written in that language with translations into it", () => {
    /** 原文是英文的文章（预留的 source_locale；索引与原文语言无关，改了 source_locale 不必重建） */
    async function englishOriginal(slug: string, title: string, contentMd: string) {
      const { id } = await createPost({ slug, title, contentMd, ...published });
      await db.update(posts).set({ sourceLocale: "en" }).where(eq(posts.id, id));
      return id;
    }
    async function translatedToEnglish(slug: string, title: string, contentMd: string) {
      const { id } = await createPost({ slug, ...published });
      await translatePost(id, "en", { title, contentMd });
      return id;
    }

    it("returns hits from both sides, ordered by rank across them", async () => {
      await englishOriginal("original-title", "Caching basics", "Some text.");
      await translatedToEnglish("translation-body", "Notes", "By the way, caching.");
      await englishOriginal("original-body", "Notes", "By the way, routing.");
      await translatedToEnglish("translation-title", "Routing basics", "Some text.");

      expect(await slugs("caching", "en")).toEqual(["original-title", "translation-body"]);
      expect(await slugs("routing", "en")).toEqual(["translation-title", "original-body"]);
    });

    it("returns at most SEARCH_RESULT_LIMIT hits in total", async () => {
      for (let i = 0; i < 12; i++) {
        await englishOriginal(`o${i}`, `Original ${i}`, "About caching.");
        await translatedToEnglish(`t${i}`, `Translation ${i}`, "About caching.");
      }
      const hits = await slugs("caching", "en");
      expect(hits).toHaveLength(SEARCH_RESULT_LIMIT);
      expect(hits.some((s) => s.startsWith("o"))).toBe(true);
      expect(hits.some((s) => s.startsWith("t"))).toBe(true);
    });

    it("ignores a same-language translation that slipped into the database", async () => {
      // API 拒绝为原文语言保存译文；这里直接写库并建好索引，验证搜索不会把它当成第二个结果或冒充原文
      const { id } = await createPost({ slug: "a", title: "原文标题", contentMd: "正文", ...published });
      await db.insert(postTranslations).values({ postId: id, locale: "zh", title: "冒牌", contentMd: "原文标题 冒牌内容", excerpt: "x", sourceHash: "0".repeat(64), origin: "human" });
      expect(await reindexTranslations(db, eq(postTranslations.postId, id))).toBe(1);

      expect((await search("原文标题", "zh")).map((hit) => hit.title.text)).toEqual(["原文标题"]);
      expect(await slugs("冒牌", "zh")).toEqual([]);
    });
  });

  it("rejects an unsupported language", async () => {
    expect((await request("GET", "/search?q=x&locale=fr", { auth: false })).status).toBe(400);
  });
});

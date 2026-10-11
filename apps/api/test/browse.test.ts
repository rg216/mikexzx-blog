import {
  adminImageSchema,
  adminPostSchema,
  archiveSchema,
  postSummaryPageSchema,
  publicPostSchema,
  searchResultSchema,
} from "@blog/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { images } from "../src/db/schema.ts";
import { setupTestApp } from "./helpers.ts";

// 内容浏览（v4.6）：按标签 / 月份筛选、归档、头图
const { db, request, createPost, createTag, translatePost } = setupTestApp({ withStorage: true });

const published = (publishedAt: string) => ({ status: "published" as const, publishedAt });

async function list(query: string) {
  const res = await request("GET", `/posts?${query}`, { auth: false });
  expect(res.status).toBe(200);
  return postSummaryPageSchema.parse(res.body);
}
const slugsOf = async (query: string) => (await list(query)).items.map((p) => p.slug);

describe("GET /posts with filters", () => {
  async function seed() {
    for (const slug of ["css", "design", "react"]) await createTag({ slug });
    await createPost({ slug: "both", tags: ["css", "design"], ...published("2026-03-10T00:00:00Z") });
    await createPost({ slug: "css-only", tags: ["css"], ...published("2026-02-10T00:00:00Z") });
    await createPost({ slug: "design-only", tags: ["design", "react"], ...published("2026-01-10T00:00:00Z") });
    await createPost({ slug: "draft", tags: ["css", "design"] });
  }

  it("keeps only posts that have every selected tag", async () => {
    await seed();
    expect(await slugsOf("tags=css")).toEqual(["both", "css-only"]);
    expect(await slugsOf("tags=css,design")).toEqual(["both"]);
    expect(await slugsOf("tags=design,css,design")).toEqual(["both"]);
    expect(await slugsOf("tags=css,react")).toEqual([]);
    expect(await slugsOf("tags=nope")).toEqual([]);
  });

  it("pages through filtered results with the cursor", async () => {
    await seed();
    const first = await list("tags=css&limit=1");
    expect(first.items.map((p) => p.slug)).toEqual(["both"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(`tags=css&limit=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}`);
    expect(second).toMatchObject({ items: [{ slug: "css-only" }], nextCursor: null });
  });

  it("filters by month in the site's time zone, both ends included", async () => {
    // 北京时间 3 月 1 日 07:00 = UTC 2 月最后一天 23:00：按站点时区算是 3 月
    await createPost({ slug: "march-first", ...published("2026-02-28T23:00:00Z") });
    // 北京时间 2 月 28 日 23:30 = UTC 2 月 28 日 15:30
    await createPost({ slug: "feb-last", ...published("2026-02-28T15:30:00Z") });
    await createPost({ slug: "april", ...published("2026-04-15T00:00:00Z") });

    expect(await slugsOf("from=2026-03&to=2026-03")).toEqual(["march-first"]);
    expect(await slugsOf("to=2026-02")).toEqual(["feb-last"]);
    expect(await slugsOf("from=2026-03")).toEqual(["april", "march-first"]);
    expect(await slugsOf("from=2026-02&to=2026-04")).toEqual(["april", "march-first", "feb-last"]);
  });

  it.each([["from=2026-13"], ["to=2026-1"], ["from=2026-05&to=2026-04"], ["tags=Not_A_Slug"], [`tags=${Array.from({ length: 11 }, (_, i) => `t${i}`).join(",")}`]])(
    "rejects %s",
    async (query) => {
      expect((await request("GET", `/posts?${query}`, { auth: false })).status).toBe(400);
    },
  );
});

describe("GET /search with filters", () => {
  it("applies tag and month filters on top of the query, in every language", async () => {
    await createTag({ slug: "css" });
    const a = await createPost({ slug: "a", title: "缓存", contentMd: "缓存策略", tags: ["css"], ...published("2026-03-10T00:00:00Z") });
    await createPost({ slug: "b", title: "缓存", contentMd: "缓存策略", ...published("2026-05-10T00:00:00Z") });
    await translatePost(a.id, "en", { title: "Caching", contentMd: "Caching strategy" });

    const search = async (query: string) =>
      searchResultSchema.parse((await request("GET", `/search?${query}`, { auth: false })).body).items.map((hit) => hit.slug);
    expect((await search(`q=${encodeURIComponent("缓存")}`)).sort()).toEqual(["a", "b"]);
    expect(await search(`q=${encodeURIComponent("缓存")}&tags=css`)).toEqual(["a"]);
    expect(await search(`q=${encodeURIComponent("缓存")}&from=2026-04`)).toEqual(["b"]);
    expect(await search("q=caching&locale=en&tags=css&to=2026-03")).toEqual(["a"]);
    expect(await search("q=caching&locale=en&from=2026-04")).toEqual([]);
  });
});

describe("GET /archive", () => {
  it("lists every published post visible in the language, newest first, with titles in that language", async () => {
    const old = await createPost({ slug: "old", title: "旧文", ...published("2025-12-01T00:00:00Z") });
    await createPost({ slug: "new", title: "新文", ...published("2026-02-01T00:00:00Z") });
    await createPost({ slug: "draft", title: "草稿" });
    await translatePost(old.id, "en", { title: "Old post" });

    const archive = async (locale: string) => archiveSchema.parse((await request("GET", `/archive?locale=${locale}`, { auth: false })).body);
    expect(await archive("zh")).toEqual([
      { slug: "new", title: "新文", publishedAt: "2026-02-01T00:00:00.000Z", locale: "zh" },
      { slug: "old", title: "旧文", publishedAt: "2025-12-01T00:00:00.000Z", locale: "zh" },
    ]);
    expect(await archive("en")).toEqual([{ slug: "old", title: "Old post", publishedAt: "2025-12-01T00:00:00.000Z", locale: "en" }]);
    expect(await archive("ja")).toEqual([]);
  });
});

describe("cover images", () => {
  const BASE = "https://img.test";
  async function libraryImage(
    name: string,
    meta: { width: number | null; height: number | null; variants?: number[] } = { width: 2400, height: 1200, variants: [640, 1280] },
    confirmed = true,
  ) {
    const key = `images/2026/10/${name.padEnd(16, "x")}.jpg`;
    const [row] = await db
      .insert(images)
      .values({
        key,
        contentType: "image/jpeg",
        size: 1000,
        width: meta.width,
        height: meta.height,
        variants: meta.variants ?? [],
        description: `${name} 的描述`,
        confirmedAt: confirmed ? new Date() : null,
      })
      .returning({ id: images.id });
    return { id: row?.id ?? 0, url: `${BASE}/${key}` };
  }

  it("shows the cover with the library's description and size on the post, in lists and in every language", async () => {
    const image = await libraryImage("cover");
    const post = await createPost({ slug: "p", coverImage: image.url, ...published("2026-03-01T00:00:00Z") });
    await translatePost(post.id, "en");

    const cover = { url: image.url, alt: "cover 的描述", width: 2400, height: 1200, variants: [640, 1280] };
    expect(adminPostSchema.parse((await request("GET", `/admin/posts/${post.id}`)).body).cover).toEqual(cover);
    expect(publicPostSchema.parse((await request("GET", "/posts/p?locale=en", { auth: false })).body).cover).toEqual(cover);
    expect((await list("locale=en")).items[0]?.cover).toEqual(cover);
    // 文章页渲染时也有它的宽高（和正文里的图片一样）
    const key = image.url.slice(BASE.length + 1);
    expect(publicPostSchema.parse((await request("GET", "/posts/p", { auth: false })).body).images[key]).toEqual({ width: 2400, height: 1200, variants: [640, 1280] });
  });

  it("counts as a use of the image, which then needs force to delete", async () => {
    const image = await libraryImage("used");
    const post = await createPost({ slug: "p", coverImage: image.url });
    const listed = z.array(adminImageSchema).parse((await request("GET", "/admin/images")).body);
    expect(listed.find((i) => i.id === image.id)?.usage).toBe(1);
    expect((await request("POST", "/admin/images/delete", { body: { ids: [image.id] } })).status).toBe(409);

    // 换掉头图：引用关系跟着更新
    await request("PATCH", `/admin/posts/${post.id}`, { body: { coverImage: null } });
    const after = z.array(adminImageSchema).parse((await request("GET", "/admin/images")).body);
    expect(after.find((i) => i.id === image.id)?.usage).toBe(0);
    expect(adminPostSchema.parse((await request("GET", `/admin/posts/${post.id}`)).body).cover).toBeNull();
  });

  it("drops a cover whose image is gone from the library, and leaves out sizes that are unknown", async () => {
    const gone = await libraryImage("gone");
    const unknown = await libraryImage("unsized", { width: null, height: null, variants: [640] });
    await createPost({ slug: "gone", coverImage: gone.url, ...published("2026-03-01T00:00:00Z") });
    await createPost({ slug: "unsized", coverImage: unknown.url, ...published("2026-02-01T00:00:00Z") });
    await request("POST", "/admin/images/delete", { body: { ids: [gone.id], force: true } });

    const items = (await list("")).items;
    expect(items.find((p) => p.slug === "gone")?.cover).toBeNull();
    expect(items.find((p) => p.slug === "unsized")?.cover).toEqual({ url: unknown.url, alt: "unsized 的描述", width: null, height: null, variants: [] });
  });

  it("does not show an image whose upload was never confirmed (the file may not exist)", async () => {
    const pending = await libraryImage("pending", { width: 100, height: 100 }, false);
    await createPost({ slug: "p", coverImage: pending.url, ...published("2026-03-01T00:00:00Z") });
    expect((await list("")).items[0]?.cover).toBeNull();
  });

    it("only accepts images from the media library", async () => {
    const res = await request("POST", "/admin/posts", { body: { slug: "p", title: "p", contentMd: "x", coverImage: "https://example.com/a.jpg" } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { issues: [{ path: "coverImage", message: "头图只能选媒体库里的图片" }] } });
  });
});

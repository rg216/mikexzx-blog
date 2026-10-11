import type { PostSummary, PublicPost } from "@blog/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublishedPost, listAllPublishedPosts, listPublishedPosts, listTags } from "./posts";

// 这里只测前端数据层自己的职责：拼 URL、翻页、404 处理、校验响应、缓存标签。API 本身的行为由 apps/api 的测试覆盖。

const summary = (slug: string): PostSummary => ({
  slug,
  title: slug,
  excerpt: `${slug} 摘要`,
  status: "published",
  publishedAt: "2026-10-01T00:00:00.000Z",
  tags: [],
  locale: "zh",
});

const fetchMock = vi.fn<typeof fetch>();
const requestedUrls = () => fetchMock.mock.calls.map(([input]) => String(input));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://api.test");
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("listPublishedPosts", () => {
  it("requests one page in the given locale from API_URL", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [summary("a")], nextCursor: "next" }));
    expect((await listPublishedPosts({ limit: 5, locale: "en" })).map((p) => p.slug)).toEqual(["a"]);
    expect(requestedUrls()).toEqual(["http://api.test/posts?limit=5&locale=en"]);
  });
});

describe("caching", () => {
  it("tags data per locale: lists with posts:<locale>, single posts with post:<slug>:<locale>, with an hourly fallback", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [], nextCursor: null }))
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    await listPublishedPosts({ locale: "zh" });
    await getPublishedPost("hello", "ja");
    await listTags("en");
    await listAllPublishedPosts("ja");
    const nextOptions = fetchMock.mock.calls.map(([, init]) => init?.next);
    expect(nextOptions).toEqual([
      { revalidate: 3600, tags: ["posts:zh"] },
      { revalidate: 3600, tags: ["post:hello:ja"] },
      { revalidate: 3600, tags: ["posts:en"] },
      { revalidate: 3600, tags: ["posts:ja"] },
    ]);
    expect(requestedUrls()).toEqual([
      "http://api.test/posts?limit=20&locale=zh",
      "http://api.test/posts/hello?locale=ja",
      "http://api.test/tags?locale=en",
      "http://api.test/posts?limit=50&locale=ja",
    ]);
  });
});

describe("listAllPublishedPosts", () => {
  it("follows the cursor until the last page", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [summary("a"), summary("b")], nextCursor: "c1" }))
      .mockResolvedValueOnce(json({ items: [summary("c")], nextCursor: null }));

    expect((await listAllPublishedPosts("zh")).map((p) => p.slug)).toEqual(["a", "b", "c"]);
    expect(requestedUrls()).toEqual(["http://api.test/posts?limit=50&locale=zh", "http://api.test/posts?limit=50&locale=zh&cursor=c1"]);
  });
});

describe("getPublishedPost", () => {
  const post: PublicPost = {
    ...summary("hello"),
    contentMd: "正文",
    images: {},
    sourceLocale: "zh",
    availableLocales: ["zh"],
    translation: null,
  };

  it("returns the post (the original when the locale has no translation)", async () => {
    fetchMock.mockResolvedValueOnce(json(post));
    expect(await getPublishedPost("hello", "en")).toEqual(post);
  });

  it("returns null on 404 (draft or missing)", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: "not_found", message: "x" } }, 404));
    expect(await getPublishedPost("nope", "zh")).toBeNull();
  });

  it("returns null for drafts that slip through", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...post, status: "draft", publishedAt: null }));
    expect(await getPublishedPost("hello", "zh")).toBeNull();
  });

  it("encodes the slug into the path", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await getPublishedPost("a/../admin", "zh");
    expect(requestedUrls()).toEqual(["http://api.test/posts/a%2F..%2Fadmin?locale=zh"]);
  });

  it("rejects responses without the public post fields (old API)", async () => {
    const old: Record<string, unknown> = { ...post };
    delete old.sourceLocale;
    delete old.availableLocales;
    delete old.translation;
    fetchMock.mockResolvedValueOnce(json(old));
    await expect(getPublishedPost("hello", "zh")).rejects.toThrow(/不符合 @blog\/shared 的约定/);
  });
});

describe("error handling", () => {
  it("throws when a response does not match the shared schema", async () => {
    fetchMock.mockResolvedValueOnce(json([{ slug: "a", name: "A" }])); // 缺 count
    await expect(listTags("zh")).rejects.toThrow(/不符合 @blog\/shared 的约定/);
  });

  it("throws on a 404 from a list endpoint (misconfigured API_URL)", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(listTags("zh")).rejects.toThrow(/返回 404/);
  });

  it("throws on server errors", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: "internal_error", message: "x" } }, 500));
    await expect(getPublishedPost("hello", "zh")).rejects.toThrow(/返回 500/);
  });

  it("explains connection failures", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(listTags("zh")).rejects.toThrow(/无法连接 API http:\/\/api\.test/);
  });
});

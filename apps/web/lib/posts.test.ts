import type { Post, PostSummary } from "@blog/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublishedPost, listAllPublishedPosts, listPublishedPosts, listTags } from "./posts";

// 这里只测前端数据层自己的职责：拼 URL、翻页、404 处理、校验响应。API 本身的行为由 apps/api 的测试覆盖。

const summary = (slug: string): PostSummary => ({
  slug,
  title: slug,
  excerpt: `${slug} 摘要`,
  status: "published",
  publishedAt: "2026-10-01T00:00:00.000Z",
  tags: [],
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
  it("requests one page from API_URL", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [summary("a")], nextCursor: "next" }));
    expect((await listPublishedPosts({ limit: 5 })).map((p) => p.slug)).toEqual(["a"]);
    expect(requestedUrls()).toEqual(["http://api.test/posts?limit=5"]);
  });
});

describe("listAllPublishedPosts", () => {
  it("follows the cursor until the last page", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [summary("a"), summary("b")], nextCursor: "c1" }))
      .mockResolvedValueOnce(json({ items: [summary("c")], nextCursor: null }));

    expect((await listAllPublishedPosts()).map((p) => p.slug)).toEqual(["a", "b", "c"]);
    expect(requestedUrls()).toEqual(["http://api.test/posts?limit=50", "http://api.test/posts?limit=50&cursor=c1"]);
  });
});

describe("getPublishedPost", () => {
  const post: Post = { ...summary("hello"), contentMd: "正文" };

  it("returns the post", async () => {
    fetchMock.mockResolvedValueOnce(json(post));
    expect(await getPublishedPost("hello")).toEqual(post);
  });

  it("returns null on 404 (draft or missing)", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: "not_found", message: "x" } }, 404));
    expect(await getPublishedPost("nope")).toBeNull();
  });

  it("encodes the slug into the path", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await getPublishedPost("a/../admin");
    expect(requestedUrls()).toEqual(["http://api.test/posts/a%2F..%2Fadmin"]);
  });
});

describe("error handling", () => {
  it("throws when a response does not match the shared schema", async () => {
    fetchMock.mockResolvedValueOnce(json([{ slug: "a", name: "A" }])); // 缺 count
    await expect(listTags()).rejects.toThrow(/不符合 @blog\/shared 的约定/);
  });

  it("throws on a 404 from a list endpoint (misconfigured API_URL)", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(listTags()).rejects.toThrow(/返回 404/);
  });

  it("throws on server errors", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: "internal_error", message: "x" } }, 500));
    await expect(getPublishedPost("hello")).rejects.toThrow(/返回 500/);
  });

  it("explains connection failures", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(listTags()).rejects.toThrow(/无法连接 API http:\/\/api\.test/);
  });
});

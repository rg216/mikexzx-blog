import type { SearchHit } from "@blog/shared";
import { describe, expect, it, vi } from "vitest";
import { SearchError, searchPosts } from "./search";

const hit: SearchHit = {
  slug: "a",
  title: { text: "标题", highlights: [] },
  snippet: { text: "摘要", highlights: [{ start: 0, end: 2 }] },
  publishedAt: "2026-10-01T00:00:00.000Z",
  tags: [],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const respond = (res: Response | Error) => vi.fn<typeof fetch>(async () => (res instanceof Error ? Promise.reject(res) : res));

describe("searchPosts", () => {
  it("requests the proxied endpoint with an encoded query and returns hits", async () => {
    const fetch = respond(json({ items: [hit] }));
    expect(await searchPosts("全栈 & next", { fetch })).toEqual([hit]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("/api/search?q=%E5%85%A8%E6%A0%88+%26+next");
  });

  it.each([
    ["rate limited", json({ error: { code: "rate_limited", message: "请求太频繁" } }, 429), "搜索太频繁，请稍等片刻再试"],
    ["validation error", json({ error: { code: "validation_error", message: "搜索内容不能超过 100 个字符" } }, 400), "搜索内容不能超过 100 个字符"],
    ["server error page", new Response("<html>502</html>", { status: 502 }), "搜索暂时不可用，请稍后重试"],
    ["malformed success", json({ items: [{ slug: "a" }] }), "搜索暂时不可用，请稍后重试"],
    ["network failure", new TypeError("Failed to fetch"), "无法连接服务器，请检查网络后重试"],
  ])("turns a %s into a readable SearchError", async (_, response, message) => {
    const error = await searchPosts("q", { fetch: respond(response) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SearchError);
    expect((error as SearchError).message).toBe(message);
  });

  it("rethrows aborts untouched so callers can ignore stale requests", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("aborted", "AbortError");
    const error = await searchPosts("q", { signal: controller.signal, fetch: respond(abort) }).catch((e: unknown) => e);
    expect(error).toBe(abort);
  });
});

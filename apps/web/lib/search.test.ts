import type { SearchHit } from "@blog/shared";
import { describe, expect, it, vi } from "vitest";
import { reasonFromStatus } from "./api-error-reason";
import { getDictionary } from "./i18n";
import { SEARCH_QUERY_MAX_LENGTH, SearchError, searchErrorText, searchPosts } from "./search";

const hit: SearchHit = {
  slug: "a",
  locale: "en",
  title: { text: "Title", highlights: [] },
  snippet: { text: "Snippet", highlights: [{ start: 0, end: 7 }] },
  publishedAt: "2026-10-01T00:00:00.000Z",
  tags: [],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const respond = (res: Response | Error) => vi.fn<typeof fetch>(async () => (res instanceof Error ? Promise.reject(res) : res));

describe("searchPosts", () => {
  it("requests the proxied endpoint with an encoded query and the locale, and returns hits", async () => {
    const fetch = respond(json({ items: [hit] }));
    expect(await searchPosts("全栈 & next", { locale: "en", fetch })).toEqual([hit]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("/api/search?q=%E5%85%A8%E6%A0%88+%26+next&locale=en");
  });

  it.each([
    ["rate limited", json({ error: { code: "rate_limited", message: "请求太频繁" } }, 429), "rate_limited"],
    ["validation error", json({ error: { code: "validation_error", message: "搜索内容不能超过 100 个字符" } }, 400), "invalid"],
    ["server error page", new Response("<html>502</html>", { status: 502 }), "unavailable"],
    ["malformed success", json({ items: [{ slug: "a" }] }), "unavailable"],
    ["network failure", new TypeError("Failed to fetch"), "network"],
  ])("turns a %s into a SearchError with a reason code", async (_, response, reason) => {
    const error = await searchPosts("q", { locale: "zh", fetch: respond(response) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SearchError);
    expect((error as SearchError).reason).toBe(reason);
    // API 的中文 message 不会透出来
    expect((error as SearchError).message).not.toMatch(/[一-鿿]/);
  });

  it("rethrows aborts untouched so callers can ignore stale requests", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("aborted", "AbortError");
    const error = await searchPosts("q", { locale: "zh", signal: controller.signal, fetch: respond(abort) }).catch((e: unknown) => e);
    expect(error).toBe(abort);
  });

  it("reads the query length limit from the shared schema", () => {
    expect(SEARCH_QUERY_MAX_LENGTH).toBe(100);
  });
});

describe("reasonFromStatus", () => {
  it.each([
    [0, "network"],
    [400, "invalid"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [502, "unavailable"],
    [409, "unavailable"],
  ] as const)("%i → %s", (status, reason) => {
    expect(reasonFromStatus(status)).toBe(reason);
  });
});

describe("searchErrorText", () => {
  it.each([
    ["network", "Can’t reach the server. Check your connection and try again."],
    ["rate_limited", "Too many searches. Please wait a moment and try again."],
    ["invalid", "Search terms can be up to 100 characters."],
    ["unavailable", "Search is temporarily unavailable. Please try again later."],
    ["forbidden", "Search is temporarily unavailable. Please try again later."],
  ] as const)("explains %s in the page language", (reason, text) => {
    expect(searchErrorText(getDictionary("en").search.errors, reason)).toBe(text);
  });

  it("uses the Japanese dictionary on Japanese pages", () => {
    expect(searchErrorText(getDictionary("ja").search.errors, "invalid")).toBe("検索語は100文字以内で入力してください。");
  });
});

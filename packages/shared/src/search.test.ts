import { describe, expect, it } from "vitest";
import { searchHitSchema, searchQuerySchema } from "./search.ts";

describe("searchQuerySchema", () => {
  it("trims the query and defaults to the default language", () => {
    expect(searchQuerySchema.parse({ q: "  缓存 " })).toEqual({ q: "缓存", locale: "zh" });
    expect(searchQuerySchema.parse({ q: "cache", locale: "en" })).toEqual({ q: "cache", locale: "en" });
  });

  it.each([{ q: "" }, { q: "   " }, { q: "x".repeat(101) }, { q: "x", locale: "fr" }])("rejects %j", (query) => {
    expect(searchQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("searchHitSchema", () => {
  const hit = {
    slug: "a",
    locale: "ja",
    title: { text: "キャッシュ", highlights: [{ start: 0, end: 5 }] },
    snippet: { text: "本文", highlights: [] },
    publishedAt: "2026-10-01T00:00:00.000Z",
    tags: [],
  };

  it("carries the language of the matched version", () => {
    expect(searchHitSchema.parse(hit)).toEqual(hit);
    expect(searchHitSchema.safeParse({ ...hit, locale: undefined }).success).toBe(false);
  });
});

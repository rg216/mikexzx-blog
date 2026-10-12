import { describe, expect, it } from "vitest";
import { cacheTags, revalidateRequestSchema } from "./cache.ts";

describe("cacheTags", () => {
  it("builds per-language list tags", () => {
    expect(cacheTags.posts("zh")).toBe("posts:zh");
    expect(cacheTags.posts("en")).toBe("posts:en");
  });

  it("builds per-post tags from the slug and the language", () => {
    expect(cacheTags.post("hello-world", "ja")).toBe("post:hello-world:ja");
  });

  it("never lets one language's tag match another's", () => {
    // 前端按标签精确匹配失效：不同语言的标签必须互不相同，也不能和列表标签相同
    const all = (["zh", "en", "ja"] as const).flatMap((l) => [cacheTags.posts(l), cacheTags.post("posts", l)]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("revalidateRequestSchema", () => {
  it("accepts a list of tags", () => {
    expect(revalidateRequestSchema.parse({ tags: ["posts:zh", "post:a:zh"] })).toEqual({ tags: ["posts:zh", "post:a:zh"] });
  });

  it("allows enough tags for a renamed post in every language", () => {
    expect(revalidateRequestSchema.safeParse({ tags: Array.from({ length: 50 }, (_, i) => `t${i}`) }).success).toBe(true);
    expect(revalidateRequestSchema.safeParse({ tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }).success).toBe(false);
  });

  it("accepts an empty list (the API status page uses it to check the shared secret)", () => {
    expect(revalidateRequestSchema.parse({ tags: [] })).toEqual({ tags: [] });
  });

  it.each([{}, { tags: ["x".repeat(257)] }, { tags: ["posts"], extra: 1 }])("rejects %j", (body) => {
    expect(revalidateRequestSchema.safeParse(body).success).toBe(false);
  });
});

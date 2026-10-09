import { describe, expect, it } from "vitest";
import { postCreateInputSchema, postSchema, postUpdateInputSchema, slugSchema } from "./post.ts";

describe("slugSchema", () => {
  it.each(["hello", "hello-world", "v0-2026"])("accepts %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it.each(["", "Hello", "hello--world", "-hello", "hello-", "你好", "a b"])("rejects %j", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });
});

describe("postSchema", () => {
  const base = {
    slug: "hello",
    title: "Hello",
    contentMd: "# Hi",
    excerpt: "Hi",
    status: "published",
    publishedAt: "2026-10-01T09:00:00+08:00",
    tags: [],
  };

  it("accepts a valid post", () => {
    expect(postSchema.parse(base)).toEqual(base);
  });

  it("rejects a non-ISO publishedAt", () => {
    expect(postSchema.safeParse({ ...base, publishedAt: "2026/10/01" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(postSchema.safeParse({ ...base, status: "archived" }).success).toBe(false);
  });
});

describe("postCreateInputSchema", () => {
  const input = { slug: "hello", title: "Hello", contentMd: "正文" };

  it("defaults status to draft and tags to []", () => {
    expect(postCreateInputSchema.parse(input)).toEqual({ ...input, status: "draft", tags: [] });
  });

  it("rejects unknown fields instead of silently dropping them", () => {
    expect(postCreateInputSchema.safeParse({ ...input, contentMD: "typo" }).success).toBe(false);
  });

  it("trims the title and rejects a blank one", () => {
    expect(postCreateInputSchema.parse({ ...input, title: "  Hi  " }).title).toBe("Hi");
    expect(postCreateInputSchema.safeParse({ ...input, title: "   " }).success).toBe(false);
  });
});

describe("postUpdateInputSchema", () => {
  it("does not fill in defaults, so a partial update leaves other fields alone", () => {
    expect(postUpdateInputSchema.parse({ title: "New" })).toEqual({ title: "New" });
  });

  it("rejects an empty update", () => {
    expect(postUpdateInputSchema.safeParse({}).success).toBe(false);
  });
});

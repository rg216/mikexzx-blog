import { describe, expect, it } from "vitest";
import { postSchema, slugSchema } from "./post.ts";

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

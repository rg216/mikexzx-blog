import { describe, expect, it } from "vitest";
import { cacheTags, revalidateRequestSchema } from "./cache.ts";

describe("cacheTags", () => {
  it("builds per-post tags from the slug", () => {
    expect(cacheTags.post("hello-world")).toBe("post:hello-world");
  });
});

describe("revalidateRequestSchema", () => {
  it("accepts a list of tags", () => {
    expect(revalidateRequestSchema.parse({ tags: ["posts", "post:a"] })).toEqual({ tags: ["posts", "post:a"] });
  });

  it.each([{}, { tags: [] }, { tags: ["x".repeat(257)] }, { tags: ["posts"], extra: 1 }])("rejects %j", (body) => {
    expect(revalidateRequestSchema.safeParse(body).success).toBe(false);
  });
});

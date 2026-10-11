import { sourceHashSchema } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { sourceHash } from "./source-hash.ts";

describe("sourceHash", () => {
  const post = { title: "标题", contentMd: "正文" };

  it("is a SHA-256 hex digest accepted by the shared schema", () => {
    expect(sourceHashSchema.safeParse(sourceHash(post)).success).toBe(true);
    // 固定值：哈希算法或编码方式变了会让所有已有译文显示为过时，必须是有意的改动
    expect(sourceHash({ title: "a", contentMd: "b" })).toBe("0473ef2dc0d324ab659d3580c1134e9d812035905c4781fdd6d529b0c6860e13");
  });

  it("is stable for the same title and content", () => {
    expect(sourceHash({ ...post })).toBe(sourceHash(post));
  });

  it("changes when the title or the content changes", () => {
    expect(sourceHash({ ...post, title: "新标题" })).not.toBe(sourceHash(post));
    expect(sourceHash({ ...post, contentMd: "正文。" })).not.toBe(sourceHash(post));
  });

  it("does not confuse where the title ends and the content begins", () => {
    expect(sourceHash({ title: "a\nb", contentMd: "c" })).not.toBe(sourceHash({ title: "a", contentMd: "b\nc" }));
    expect(sourceHash({ title: "ab", contentMd: "" })).not.toBe(sourceHash({ title: "a", contentMd: "b" }));
  });
});

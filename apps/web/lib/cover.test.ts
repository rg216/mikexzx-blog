import type { PostCover } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { coverSrcSet, ogImageOf } from "./cover";

const cover = (overrides: Partial<PostCover> = {}): PostCover => ({
  url: "https://img.test/images/2026/10/AbCdEfGh_jKlMn-p.jpg",
  alt: "描述",
  width: 2560,
  height: 1280,
  variants: [640, 1280, 1920],
  ...overrides,
});

describe("coverSrcSet", () => {
  it("lists every variant and the original with their widths", () => {
    expect(coverSrcSet(cover())).toBe(
      "https://img.test/images/2026/10/AbCdEfGh_jKlMn-p-640w.jpg 640w, https://img.test/images/2026/10/AbCdEfGh_jKlMn-p-1280w.jpg 1280w, https://img.test/images/2026/10/AbCdEfGh_jKlMn-p-1920w.jpg 1920w, https://img.test/images/2026/10/AbCdEfGh_jKlMn-p.jpg 2560w",
    );
  });

  it("gives nothing when there are no variants or the width is unknown", () => {
    expect(coverSrcSet(cover({ variants: [] }))).toBeUndefined();
    expect(coverSrcSet(cover({ width: null, height: null }))).toBeUndefined();
  });
});

describe("ogImageOf", () => {
  it("picks the smallest variant of at least 1200px, scaling the height", () => {
    expect(ogImageOf(cover())).toEqual({ url: "https://img.test/images/2026/10/AbCdEfGh_jKlMn-p-1280w.jpg", width: 1280, height: 640, alt: "描述" });
  });

  it("falls back to the original when no variant is big enough, or the size is unknown", () => {
    expect(ogImageOf(cover({ width: 1000, height: 500, variants: [640] }))).toEqual({ url: cover().url, width: 1000, height: 500, alt: "描述" });
    expect(ogImageOf(cover({ width: null, height: null }))).toEqual({ url: cover().url, alt: "描述" });
  });
});

import { describe, expect, it } from "vitest";
import { formatBytes, markdownForImage, thumbnailUrl } from "./media";

const url = "https://img.test/images/2026/10/AbCdEfGh_jKlMn-p.jpg";

describe("thumbnailUrl", () => {
  it("picks the smallest variant that is wide enough", () => {
    expect(thumbnailUrl({ url, variants: [1920, 640, 1280] })).toBe("https://img.test/images/2026/10/AbCdEfGh_jKlMn-p-640w.jpg");
    expect(thumbnailUrl({ url, variants: [640, 1280] }, 1000)).toBe("https://img.test/images/2026/10/AbCdEfGh_jKlMn-p-1280w.jpg");
  });

  it("falls back to the original", () => {
    expect(thumbnailUrl({ url, variants: [] })).toBe(url);
  });
});

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [1536, "1.5 KB"],
    [1_572_864, "1.5 MB"],
    [12_582_912, "12 MB"],
  ])("formats %d", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("markdownForImage", () => {
  it("uses the default description and writes the size fragment", () => {
    expect(markdownForImage({ url, description: "海边" }, { preset: "small" })).toBe(`![海边](${url}#small)`);
    expect(markdownForImage({ url, description: "" }, { width: 480 })).toBe(`![](${url}#w=480)`);
    expect(markdownForImage({ url, description: "" }, null)).toBe(`![](${url})`);
  });
});

import { describe, expect, it } from "vitest";
import { imageKeyOf, imageKeysIn, parseImageSize, variantUrl, withImageSize } from "./media.ts";

const url = "https://pub-x.r2.dev/images/2026/10/AbCdEfGh_jKlMn-p.jpg";

describe("image keys", () => {
  it("finds the key regardless of the host, and maps variants to the original", () => {
    expect(imageKeyOf(url)).toBe("images/2026/10/AbCdEfGh_jKlMn-p.jpg");
    expect(imageKeyOf("https://img.example.com/images/2026/10/AbCdEfGh_jKlMn-p-640w.jpg#small")).toBe("images/2026/10/AbCdEfGh_jKlMn-p.jpg");
    expect(imageKeyOf("https://elsewhere.example/photo.jpg")).toBeNull();
  });

  it("does not mistake an id that happens to end like a suffix for a variant", () => {
    expect(imageKeyOf("https://x/images/2026/10/abcdefghijk-640w.png")).toBe("images/2026/10/abcdefghijk-640w.png");
  });

  it("collects every referenced image once", () => {
    const md = `![a](${url}) 和 ![b](${url}#small)\n\n![c](https://x/images/2026/09/0123456789abcdef.png)`;
    expect(imageKeysIn(md)).toEqual(["images/2026/10/AbCdEfGh_jKlMn-p.jpg", "images/2026/09/0123456789abcdef.png"]);
  });

  it("builds variant URLs", () => {
    expect(variantUrl(url, 640)).toBe("https://pub-x.r2.dev/images/2026/10/AbCdEfGh_jKlMn-p-640w.jpg");
  });
});

describe("display size fragments", () => {
  it.each([
    [`${url}#small`, { preset: "small" }],
    [`${url}#large`, { preset: "large" }],
    [`${url}#w=320`, { width: 320 }],
  ])("parses %s", (src, size) => {
    expect(parseImageSize(src)).toEqual({ src: url, size });
  });

  it("leaves unknown or out-of-range fragments alone", () => {
    expect(parseImageSize(`${url}#huge`)).toEqual({ src: `${url}#huge`, size: null });
    expect(parseImageSize(`${url}#w=5`)).toEqual({ src: `${url}#w=5`, size: null });
    expect(parseImageSize(url)).toEqual({ src: url, size: null });
  });

  it("writes and replaces the fragment", () => {
    expect(withImageSize(url, { preset: "medium" })).toBe(`${url}#medium`);
    expect(withImageSize(`${url}#small`, { width: 480 })).toBe(`${url}#w=480`);
    expect(withImageSize(`${url}#small`, null)).toBe(url);
  });
});

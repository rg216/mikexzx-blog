import { describe, expect, it } from "vitest";
import { base64ToBlob, coverFileName, dataUrl, formatImageUsage, imageModelLabel, qualityLabel } from "./cover-generation";

describe("base64ToBlob", () => {
  it("decodes the bytes and keeps the type", async () => {
    const blob = base64ToBlob(btoa("RIFF\u0000ÿWEBP"), "image/webp");
    expect(blob.type).toBe("image/webp");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([82, 73, 70, 70, 0, 255, 87, 69, 66, 80]);
  });
});

describe("coverFileName", () => {
  it("names the file after the slug and the candidate number", () => {
    expect(coverFileName("hello-world", 2, "image/webp")).toBe("cover-hello-world-2.webp");
    expect(coverFileName("  Next.js 16 ", 1, "image/jpeg")).toBe("cover-next-js-16-1.jpg");
    expect(coverFileName("", 1, "image/png")).toBe("cover-untitled-1.png");
    expect(coverFileName("中文", 3, "image/webp")).toBe("cover-untitled-3.webp");
  });
});

describe("labels", () => {
  it("formats models, qualities, usage and data URLs", () => {
    expect(imageModelLabel("gpt-image-2.5-flare")).toBe("GPT Image 2.5 Flare");
    expect(qualityLabel("high")).toBe("高");
    expect(formatImageUsage({ inputTokens: 1234, outputTokens: 6208 })).toBe("输入 1,234 · 输出 6,208 token");
    expect(dataUrl("AAAA", "image/webp")).toBe("data:image/webp;base64,AAAA");
  });
});

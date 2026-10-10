import { describe, expect, it } from "vitest";
import { fitWithin, isAllowedImageType, shouldReencode } from "./image-prepare";

// prepareImage 依赖浏览器的 createImageBitmap / OffscreenCanvas，在端到端测试里验证；这里测纯计算部分

describe("fitWithin", () => {
  it("scales the long edge down to the limit, keeping the aspect ratio", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3000, 6000, 1000)).toEqual({ width: 500, height: 1000 });
  });

  it("never scales up", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("keeps at least one pixel for extreme panoramas", () => {
    expect(fitWithin(100_000, 10)).toEqual({ width: 2560, height: 1 });
  });
});

describe("image types", () => {
  it("only re-encodes formats the canvas can write without losing anything important", () => {
    expect(shouldReencode("image/jpeg")).toBe(true);
    expect(shouldReencode("image/png")).toBe(true);
    expect(shouldReencode("image/gif")).toBe(false); // 动图会只剩第一帧
    expect(shouldReencode("image/avif")).toBe(false);
  });

  it("rejects SVG and non-images", () => {
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
    expect(isAllowedImageType("application/pdf")).toBe(false);
    expect(isAllowedImageType("image/webp")).toBe(true);
  });
});

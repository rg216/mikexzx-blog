import { describe, expect, it } from "vitest";
import { readImageDimensions } from "./image-dimensions.ts";

// 真实文件：Chrome 的 OffscreenCanvas 编码出的 37×23 图片
const real = {
  png: "iVBORw0KGgoAAAANSUhEUgAAACUAAAAXCAYAAACMLIalAAAAXklEQVR4AezSsQkAIBBD0cPSsVzLxkLXcjVd4R9YGIiQLoV5Wuo857eU+PD4UvRRdKT6HkFCl2d7OlLZZa/7lqKilrIUFaA9nT+12ggSujzb05HKLnvdtxQVtZS01AUAAP//sOm1sgAAAAZJREFUAwC7HnxrM0OipQAAAABJRU5ErkJggg==",
  jpeg: "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAXACUDASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAUDBP/EABsQAAMBAQEBAQAAAAAAAAAAAAABAgMRBEEh/8QAFwEBAQEBAAAAAAAAAAAAAAAAAAYFB//EAB0RAAEDBQEAAAAAAAAAAAAAAAABAwQFISIxQRH/2gAMAwEAAhEDEQA/AImuiylVSbXefhnPqiqUpV1vg9kuskpTb78Ry5Z2tYbikur4dCmzZLUlG20xtwmqXS4MiCrzy5375rViiADcJMAAAAAAAAAAAA//2Q==",
  webpVp8x: "UklGRmwCAABXRUJQVlA4WAoAAAAgAAAAJAAAFgAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggfgAAAJAEAJ0BKiUAFwA+bTKTR6QioaElazCADYloAHcF8A/FXhAQgAAcbXMIutkyAAD+nKhO24TehhItf//V4dR/qKai8Y1mP2Ef6iDztPq1f/+f/kjR/peF/H/VzOjTf/Jc4hxn/s9PUafqdm3NLrKFi6dPtlhUsW4dJ0OiAAAAAA==",
};
const fromBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

/** 按格式规范手工拼出最小的文件头（Chrome 不会生成这几种子格式） */
function riff(chunk: string, payload: number[]): Uint8Array {
  const body = [...Buffer.from("WEBP"), ...Buffer.from(chunk), payload.length, 0, 0, 0, ...payload];
  return new Uint8Array([...Buffer.from("RIFF"), body.length & 0xff, 0, 0, 0, ...body]);
}

describe("readImageDimensions", () => {
  it.each(Object.entries(real))("reads a real %s", (_, b64) => {
    expect(readImageDimensions(fromBase64(b64))).toEqual({ width: 37, height: 23 });
  });

  it("reads lossy WebP (VP8)", () => {
    // 帧标记 3 字节、起始码 9d 01 2a，然后 14 位宽、14 位高（小端）
    const vp8 = riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 37, 0, 23, 0]);
    expect(readImageDimensions(vp8)).toEqual({ width: 37, height: 23 });
  });

  it("reads lossless WebP (VP8L)", () => {
    // 签名 0x2f，然后 (宽-1) | (高-1) << 14
    const bits = 36 | (22 << 14);
    const vp8l = riff("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff, 0, 0, 0, 0]);
    expect(readImageDimensions(vp8l)).toEqual({ width: 37, height: 23 });
  });

  it("reads GIF", () => {
    expect(readImageDimensions(new Uint8Array([...Buffer.from("GIF89a"), 0x10, 0x02, 0xc8, 0x00]))).toEqual({ width: 528, height: 200 });
  });

  it("reads AVIF from the ispe property", () => {
    const box = (type: string, payload: number[]) => [0, 0, 0, 8 + payload.length, ...Buffer.from(type), ...payload];
    const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const file = new Uint8Array([...box("ftyp", [...Buffer.from("avif"), 0, 0, 0, 0]), ...box("ispe", [0, 0, 0, 0, ...u32(4032), ...u32(3024)])]);
    expect(readImageDimensions(file)).toEqual({ width: 4032, height: 3024 });
  });

  it("finds the JPEG frame header behind large metadata segments", () => {
    const jpeg = fromBase64(real.jpeg);
    // 在 SOI 之后插入一个 2KB 的 APP1 段（模拟 EXIF）
    const app1 = [0xff, 0xe1, 0x08, 0x02, ...new Array(2048).fill(0)];
    expect(readImageDimensions(new Uint8Array([...jpeg.subarray(0, 2), ...app1, ...jpeg.subarray(2)]))).toEqual({ width: 37, height: 23 });
  });

  it.each([
    ["empty", new Uint8Array()],
    ["text", new Uint8Array(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))],
    ["truncated PNG", fromBase64(real.png).subarray(0, 20)],
    ["zero-sized GIF", new Uint8Array([...Buffer.from("GIF89a"), 0, 0, 0, 0])],
  ])("returns null for %s", (_, bytes) => {
    expect(readImageDimensions(bytes)).toBeNull();
  });
});

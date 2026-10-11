import { describe, expect, it } from "vitest";
import { createLineDecoder, LineDecodeError, readLines } from "./ndjson";

const encoder = new TextEncoder();

/** 把字节按给定的位置切成若干块 */
function chunksAt(bytes: Uint8Array, cuts: number[]): Uint8Array[] {
  const points = [0, ...cuts, bytes.length];
  return points.slice(1).map((end, i) => bytes.slice(points[i], end));
}

/** 逐块送进解码器，收集所有行 */
function decodeAll(chunks: Uint8Array[]): string[] {
  const decoder = createLineDecoder();
  return [...chunks.flatMap((chunk) => decoder.push(chunk)), ...decoder.end()];
}

function streamOf(chunks: Uint8Array[]): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let cancelled = false;
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
}

describe("createLineDecoder", () => {
  it("returns complete lines and keeps a half line for the next chunk", () => {
    const decoder = createLineDecoder();
    expect(decoder.push(encoder.encode('{"a":1}\n{"b"'))).toEqual(['{"a":1}']);
    expect(decoder.push(encoder.encode(":2}\n"))).toEqual(['{"b":2}']);
    expect(decoder.end()).toEqual([]);
  });

  it("reassembles a multi-byte character split across chunks", () => {
    const bytes = encoder.encode('{"text":"译文"}\n');
    // "译" 的 3 个字节从中间切开
    const start = bytes.indexOf(0xe8);
    expect(start).toBeGreaterThan(0);
    expect(decodeAll(chunksAt(bytes, [start + 1]))).toEqual(['{"text":"译文"}']);
    expect(decodeAll(chunksAt(bytes, [start + 2]))).toEqual(['{"text":"译文"}']);
  });

  it("gives the same lines however the bytes are chunked (every single cut point, and one byte at a time)", () => {
    const text = '{"type":"delta","text":"日本語 🎌"}\n{"type":"delta","text":"English"}\r\n\n{"type":"done"}';
    const bytes = encoder.encode(text);
    const expected = ['{"type":"delta","text":"日本語 🎌"}', '{"type":"delta","text":"English"}', '{"type":"done"}'];
    for (let cut = 1; cut < bytes.length; cut++) expect(decodeAll(chunksAt(bytes, [cut]))).toEqual(expected);
    expect(decodeAll(chunksAt(bytes, Array.from({ length: bytes.length - 1 }, (_, i) => i + 1)))).toEqual(expected);
  });

  it("returns several lines from one chunk, skipping blank lines and stripping CR", () => {
    expect(decodeAll([encoder.encode("a\r\n\n  \nb\nc\n")])).toEqual(["a", "b", "c"]);
  });

  it("flushes a last line without a trailing newline at the end", () => {
    const decoder = createLineDecoder();
    expect(decoder.push(encoder.encode("a\nb"))).toEqual(["a"]);
    expect(decoder.end()).toEqual(["b"]);
  });

  it("rejects invalid UTF-8 instead of producing replacement characters", () => {
    const decoder = createLineDecoder();
    expect(() => decoder.push(new Uint8Array([0x61, 0xff, 0x0a]))).toThrow(LineDecodeError);
  });

  it("rejects a stream that ends in the middle of a character", () => {
    const decoder = createLineDecoder();
    const bytes = encoder.encode("译");
    expect(decoder.push(bytes.slice(0, 2))).toEqual([]);
    expect(() => decoder.end()).toThrow(LineDecodeError);
  });
});

describe("readLines", () => {
  it("yields lines from a chunked byte stream and releases it when done", async () => {
    const bytes = encoder.encode("一\n二\n三");
    const { stream, cancelled } = streamOf(chunksAt(bytes, [1, 4, 5]));
    expect(await collect(readLines(stream))).toEqual(["一", "二", "三"]);
    expect(cancelled()).toBe(false);
    expect(stream.locked).toBe(false);
  });

  it("cancels the underlying stream when the consumer stops early", async () => {
    const { stream, cancelled } = streamOf([encoder.encode("a\nb\n"), encoder.encode("c\n")]);
    for await (const line of readLines(stream)) {
      if (line === "a") break;
    }
    expect(cancelled()).toBe(true);
  });

  it("cancels the stream and propagates decode errors", async () => {
    const { stream, cancelled } = streamOf([new Uint8Array([0xff, 0x0a]), encoder.encode("more\n")]);
    await expect(collect(readLines(stream))).rejects.toBeInstanceOf(LineDecodeError);
    expect(cancelled()).toBe(true);
  });
});

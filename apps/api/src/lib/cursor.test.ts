import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.ts";

describe("cursor", () => {
  it("round-trips publishedAt (ms precision) and id", () => {
    const cursor = { publishedAt: new Date("2026-10-09T01:02:03.456Z"), id: 42 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("produces a URL-safe string", () => {
    expect(encodeCursor({ publishedAt: new Date(), id: 1 })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["garbage", "not-a-cursor"],
    ["valid base64 but not JSON", Buffer.from("hello").toString("base64url")],
    ["JSON with wrong shape", Buffer.from(JSON.stringify({ p: "yesterday", i: 1 })).toString("base64url")],
    ["a non-positive id", Buffer.from(JSON.stringify({ p: "2026-01-01T00:00:00Z", i: 0 })).toString("base64url")],
  ])("returns null for %s", (_name, value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});

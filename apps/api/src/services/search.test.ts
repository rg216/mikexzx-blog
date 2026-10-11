import { describe, expect, it } from "vitest";
import { compareHits } from "./search.ts";

const hit = (id: number, rank: number, publishedAt: string | null) => ({
  id,
  slug: `p${id}`,
  title: "",
  contentMd: "",
  publishedAt: publishedAt === null ? null : new Date(publishedAt),
  rank,
});
const order = (...hits: ReturnType<typeof hit>[]) => hits.sort(compareHits).map((h) => h.id);

describe("compareHits", () => {
  it("puts higher rank first, even when that post is older and has the smaller id", () => {
    expect(order(hit(2, 0.1, "2026-02-01T00:00:00Z"), hit(1, 0.5, "2026-01-01T00:00:00Z"))).toEqual([1, 2]);
  });

  it("orders equal ranks by publish date, newest first, even when id order disagrees", () => {
    expect(order(hit(2, 0.3, "2026-01-01T00:00:00Z"), hit(1, 0.3, "2026-02-01T00:00:00Z"))).toEqual([1, 2]);
  });

  it("falls back to the larger id when rank and date are equal", () => {
    expect(order(hit(1, 0.3, "2026-01-01T00:00:00Z"), hit(2, 0.3, "2026-01-01T00:00:00Z"))).toEqual([2, 1]);
  });

  it("sorts a missing publish date last among equal ranks", () => {
    expect(order(hit(2, 0.3, null), hit(1, 0.3, "2026-01-01T00:00:00Z"))).toEqual([1, 2]);
  });
});

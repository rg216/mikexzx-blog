import { describe, expect, it } from "vitest";
import { splitHighlights } from "./highlight";

describe("splitHighlights", () => {
  it("splits text into plain and highlighted parts", () => {
    expect(splitHighlights({ text: "学习全栈开发", highlights: [{ start: 2, end: 4 }] })).toEqual([
      { text: "学习", highlighted: false },
      { text: "全栈", highlighted: true },
      { text: "开发", highlighted: false },
    ]);
  });

  it("handles highlights at both edges and none at all", () => {
    expect(splitHighlights({ text: "abc", highlights: [{ start: 0, end: 1 }, { start: 2, end: 3 }] })).toEqual([
      { text: "a", highlighted: true },
      { text: "b", highlighted: false },
      { text: "c", highlighted: true },
    ]);
    expect(splitHighlights({ text: "abc", highlights: [] })).toEqual([{ text: "abc", highlighted: false }]);
  });

  it("ignores out-of-range and overlapping ranges instead of breaking", () => {
    expect(
      splitHighlights({
        text: "abcdef",
        highlights: [
          { start: 1, end: 3 },
          { start: 2, end: 4 },
          { start: 5, end: 99 },
        ],
      }),
    ).toEqual([
      { text: "a", highlighted: false },
      { text: "bc", highlighted: true },
      { text: "d", highlighted: true },
      { text: "e", highlighted: false },
      { text: "f", highlighted: true },
    ]);
  });
});

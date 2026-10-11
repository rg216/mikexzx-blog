import { describe, expect, it } from "vitest";
import { isWordChar, WORD_BACKOFF, wordSafeEnd, wordSafeStart } from "./word-boundary.ts";

const g = (text: string) => Array.from(text);

describe("isWordChar", () => {
  it.each(["a", "Z", "7", "é", "한"])("treats %s as part of a space-separated word", (char) => {
    expect(isWordChar(char)).toBe(true);
  });
  it.each(["中", "あ", "カ", " ", "-", "。", undefined])("does not treat %j as a word char", (char) => {
    expect(isWordChar(char)).toBe(false);
  });
});

describe("wordSafeEnd", () => {
  it("backs off to the start of a word that would be cut", () => {
    expect(wordSafeEnd(g("hello world"), 8)).toBe(6);
  });
  it("keeps cuts that are already at a boundary", () => {
    expect(wordSafeEnd(g("hello world"), 5)).toBe(5);
    expect(wordSafeEnd(g("hello world"), 6)).toBe(6);
  });
  it("cuts CJK anywhere and keeps the CJK before a Latin word", () => {
    expect(wordSafeEnd(g("中文中文"), 2)).toBe(2);
    expect(wordSafeEnd(g("以及TypeScript"), 6)).toBe(2);
  });
  it("cuts words longer than the back-off limit", () => {
    const long = `x ${"a".repeat(WORD_BACKOFF + 5)}`;
    expect(wordSafeEnd(g(long), WORD_BACKOFF + 3)).toBe(WORD_BACKOFF + 3);
  });
});

describe("wordSafeStart", () => {
  it("moves forward past a word that would be cut", () => {
    expect(wordSafeStart(g("hello world"), 2, 10)).toBe(5);
  });
  it("keeps starts at a boundary", () => {
    expect(wordSafeStart(g("hello world"), 6, 10)).toBe(6);
    expect(wordSafeStart(g("中文中文"), 1, 3)).toBe(1);
  });
  it("does not move past the limit", () => {
    expect(wordSafeStart(g("hello world"), 2, 4)).toBe(2);
  });
  it("leaves very long words alone", () => {
    const long = `${"a".repeat(WORD_BACKOFF + 10)} b`;
    expect(wordSafeStart(g(long), 1, long.length)).toBe(1);
  });
});

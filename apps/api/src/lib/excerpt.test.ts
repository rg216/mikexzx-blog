import { describe, expect, it } from "vitest";
import { excerptFromMarkdown } from "./excerpt.ts";

describe("excerptFromMarkdown", () => {
  it("uses paragraph text only, without markdown syntax", () => {
    const md = "# 标题\n\n第一段，**加粗**和`代码`。\n\n```js\nconst x = 1;\n```\n\n第二段。";
    expect(excerptFromMarkdown(md)).toBe("第一段，加粗和代码。第二段。");
  });

  it("keeps spaces between Latin words but not between CJK characters", () => {
    expect(excerptFromMarkdown("Hello\nworld.\n\n中文\n换行。\n\nEnd 结尾")).toBe("Hello world. 中文换行。End 结尾");
  });

  it("returns short text unchanged", () => {
    expect(excerptFromMarkdown("短文。", 10)).toBe("短文。");
  });

  it("truncates by grapheme and appends an ellipsis", () => {
    expect(excerptFromMarkdown("一二三四五六", 4)).toBe("一二三四…");
  });

  it("never splits an emoji", () => {
    // 👨‍👩‍👧 是由多个码点组成的一个字素
    expect(excerptFromMarkdown("👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧", 2)).toBe("👨‍👩‍👧👨‍👩‍👧…");
  });

  it("returns an empty string when there are no paragraphs", () => {
    expect(excerptFromMarkdown("# 只有标题\n\n- 列表")).toBe("");
  });

  describe("in languages that separate words with spaces", () => {
    it("does not cut a word in half", () => {
      // 第 10 个字素是 "brown" 的 "r"
      expect(excerptFromMarkdown("The quick brown fox", 11)).toBe("The quick…");
    });

    it("keeps a word that ends exactly at the limit", () => {
      expect(excerptFromMarkdown("The quick brown fox", 9)).toBe("The quick…");
      expect(excerptFromMarkdown("The quick brown fox", 10)).toBe("The quick…");
    });

    it("backs off to the space before a Latin word inside Chinese text", () => {
      expect(excerptFromMarkdown("我们使用 TypeScript 编写", 8)).toBe("我们使用…");
    });

    it("still cuts between CJK characters anywhere, even with spaces nearby", () => {
      expect(excerptFromMarkdown("用 Hugo 写一个博客的过程", 10)).toBe("用 Hugo 写一个…");
      expect(excerptFromMarkdown("これは 日本語の文章です", 7)).toBe("これは 日本語…");
    });

    it("backs off only to the start of the Latin word, keeping CJK text before it", () => {
      expect(excerptFromMarkdown("前端用 Next 和 React 以及TypeScript编写", 22)).toBe("前端用 Next 和 React 以及…");
      expect(excerptFromMarkdown("これは日本語のJavaScript入門", 12)).toBe("これは日本語の…");
    });

    it("cuts between kana anywhere, even with a space nearby", () => {
      expect(excerptFromMarkdown("Claude Code でプログラミングを楽しむ", 15)).toBe("Claude Code でプロ…");
    });

    it("treats combining marks as part of the word (NFD text)", () => {
      expect(excerptFromMarkdown("Le café ouvert".normalize("NFD"), 6)).toBe("Le…");
    });

    it("does not back off when the cut already follows CJK text or punctuation", () => {
      expect(excerptFromMarkdown("用 Vue 和React开发", 7)).toBe("用 Vue 和…");
      expect(excerptFromMarkdown("Hi foo,bar baz", 7)).toBe("Hi foo,…");
    });

    it("backs off to a space in Korean, which separates words with spaces", () => {
      expect(excerptFromMarkdown("저는 오늘 새로운 프레임워크를 사용하여 블로그를 만들었습니다", 20)).toBe("저는 오늘 새로운 프레임워크를…");
    });

    it("cuts a very long word when there is no space to fall back to", () => {
      const url = `see ${"x".repeat(60)}`;
      expect(excerptFromMarkdown(url, 40)).toBe(`see ${"x".repeat(36)}…`);
    });
  });
});

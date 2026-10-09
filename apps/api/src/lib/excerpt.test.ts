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
});

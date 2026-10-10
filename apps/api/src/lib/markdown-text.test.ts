import { describe, expect, it } from "vitest";
import { plainTextFromMarkdown } from "./markdown-text.ts";

describe("plainTextFromMarkdown", () => {
  it("keeps headings, lists, code and image alt text", () => {
    const md = ["# 标题", "", "- 第一项", "- second", "", "```js", "const answer = 42;", "```", "", "![一张图](a.png)"].join("\n");
    expect(plainTextFromMarkdown(md)).toBe("标题 第一项 second const answer = 42; 一张图");
  });

  it("does not split words broken up by inline formatting", () => {
    expect(plainTextFromMarkdown("**全**栈开发，foo**bar**")).toBe("全栈开发，foobar");
  });

  it("separates blocks with a space, except next to full-width punctuation", () => {
    expect(plainTextFromMarkdown("## 规则只有一条\n\n能外包的功能。\n\n刻意自己实现")).toBe("规则只有一条 能外包的功能。刻意自己实现");
  });

  it("joins soft line breaks inside Chinese text without a space", () => {
    expect(plainTextFromMarkdown("中文段落\n换行之后")).toBe("中文段落换行之后");
  });

  it("drops raw HTML and link URLs but keeps link text", () => {
    expect(plainTextFromMarkdown('看<span class="x">这里</span>和 [文档](https://example.com/secret)')).toBe("看这里和文档");
  });
});

import { describe, expect, it } from "vitest";
import { renderCommentMarkdown } from "./comment-markdown";

describe("renderCommentMarkdown", () => {
  it("renders the basics", () => {
    expect(renderCommentMarkdown("**粗体** 和 `代码`\n\n- 列表")).toBe("<p><strong>粗体</strong> 和 <code>代码</code></p>\n<ul>\n<li>列表</li>\n</ul>");
  });

  it("marks links as user-generated and nofollow", () => {
    expect(renderCommentMarkdown("[站点](https://example.com)")).toBe(
      '<p><a href="https://example.com" rel="nofollow ugc noopener noreferrer">站点</a></p>',
    );
  });

  it("drops images entirely (no tracking pixels)", () => {
    expect(renderCommentMarkdown("看图 ![x](https://tracker.example/p.gif)")).toBe("<p>看图 </p>");
  });

  it("flattens headings into plain text", () => {
    expect(renderCommentMarkdown("# 大标题")).toBe("大标题");
  });

  it.each([
    ["<script>alert(1)</script>", "script"],
    ['<img src=x onerror="alert(1)">', "onerror"],
    ["[点我](javascript:alert(1))", "javascript:"],
    ['<a href="https://x" onclick="alert(1)">x</a>', "onclick"],
  ])("neutralizes %s", (input, forbidden) => {
    expect(renderCommentMarkdown(input)).not.toContain(forbidden);
  });
});

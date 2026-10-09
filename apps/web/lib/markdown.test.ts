import { describe, expect, it } from "vitest";
import { excerptFromMarkdown, renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders GFM tables and task lists", async () => {
    const html = await renderMarkdown("| a | b |\n| - | -: |\n| 1 | 2 |\n\n- [x] done");
    expect(html).toContain("<table>");
    expect(html).toContain('<td align="right">2</td>');
    expect(html).toContain('<input type="checkbox" checked disabled>');
  });

  describe("sanitization", () => {
    it.each([
      ["inline event handlers", '<img src="x" onerror="alert(1)">', "onerror"],
      ["script tags", "<script>alert(1)</script>", "<script"],
      ["iframes", '<iframe src="https://evil.example"></iframe>', "<iframe"],
      ["javascript: links", "[click](javascript:alert(1))", "javascript:"],
      ["data: links", "[click](data:text/html;base64,PHNjcmlwdD4=)", "data:"],
    ])("strips %s", async (_name, input, forbidden) => {
      const html = await renderMarkdown(input);
      expect(html.toLowerCase()).not.toContain(forbidden);
    });

    it("keeps safe links", async () => {
      const html = await renderMarkdown("[ok](https://example.com)");
      expect(html).toContain('<a href="https://example.com">ok</a>');
    });

    it("escapes HTML inside code blocks instead of dropping it", async () => {
      const html = await renderMarkdown("```html\n<script>alert(1)</script>\n```");
      expect(html).toContain("&#x3C;script>alert(1)&#x3C;/script>");
    });
  });

  it("produces footnote ids that match their links", async () => {
    const html = await renderMarkdown("正文[^a]\n\n[^a]: 注释");
    const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(ids).toContain(href);
  });
});

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
});

describe("images", () => {
  it("turns a standalone image into a figure with its title as caption", async () => {
    const html = await renderMarkdown('![一张图](/images/a.png "图注文字")');
    expect(html).toBe(
      '<figure><img src="/images/a.png" alt="一张图" loading="lazy" decoding="async"><figcaption>图注文字</figcaption></figure>',
    );
  });

  it("omits the caption when there is no title", async () => {
    const html = await renderMarkdown("![一张图](/images/a.png)");
    expect(html).toBe('<figure><img src="/images/a.png" alt="一张图" loading="lazy" decoding="async"></figure>');
  });

  it("keeps inline images inside paragraphs, but still lazy-loads them", async () => {
    const html = await renderMarkdown("文字 ![图](/a.png) 文字");
    expect(html).toBe('<p>文字 <img src="/a.png" alt="图" loading="lazy" decoding="async"> 文字</p>');
  });

  it("escapes HTML in captions", async () => {
    const html = await renderMarkdown('![x](/a.png "<script>alert(1)</script>")');
    expect(html).not.toContain("<script>");
    expect(html).toContain("<figcaption>&#x3C;script>alert(1)&#x3C;/script></figcaption>");
  });

  it("strips javascript: image sources", async () => {
    const html = await renderMarkdown("![x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
});

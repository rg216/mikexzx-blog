import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  canonicalLinkUrl,
  checkTranslationStructure,
  combineModelNames,
  fitModelName,
  fitTranslatedSegment,
  type StructureIssue,
  splitMarkdownForTranslation,
  structureErrorKinds,
  structureWarningKinds,
  TRANSLATION_SEGMENT_MAX_CHARS,
  translationConfigSchema,
  translationGenerateInputSchema,
  translationStreamEventSchema,
  translationTitleResultSchema,
  translationUsageSchema,
} from "./translation.ts";
import { translationInputSchema } from "./post.ts";

/**
 * "线性时间"测试的上限。这些测试用 20 万字符的病态输入抓二次方（或更糟）的退化：那种退化要跑好几秒甚至几分钟，
 * 正常实现本机几十毫秒。上限不贴着本机速度定（之前的 100–200ms 在 GitHub Actions 的机器上偶尔超时），
 * 1 秒既不会因为 CI 慢一点而失败，又比任何二次方退化快几个数量级。
 */
const LINEAR_TIME_BUDGET_MS = 1000;

/** 测试里独立解析一次，用来检查段的边界落在哪种块上（不依赖被测模块的内部实现） */
function topLevelTypes(markdown: string): string[] {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown)
    .children.map((node) => node.type);
}

const fence = "```";

// ---------- 分段 ----------

/** 各种 Markdown 形状：每个都必须"切开再拼回去 = 原文"，无论 maxChars 多小 */
const roundTripCases: Record<string, string> = {
  "plain Chinese paragraphs": "第一段文字。\n\n第二段文字，有**加粗**和`代码`。\n\n第三段。\n",
  "no trailing newline": "# 标题\n\n只有一段",
  "leading blank lines and spaces": "\n\n   \n# 标题\n\n正文\n",
  "trailing blank lines": "正文\n\n\n\n",
  "code fence with blank lines inside": `说明：\n\n${fence}ts\nconst a = 1;\n\n\nconst b = 2;\n${fence}\n\n后记\n`,
  "tilde fence and indented code": "~~~\n代码\n\n继续\n~~~\n\n段落\n\n    缩进代码\n\n    第二行\n\n结尾\n",
  "table": "| 名称 | 说明 |\n| --- | :-: |\n| 甲 | 一 |\n| 乙 | 二 |\n\n表格之后\n",
  "loose list with blank lines between items": "- 第一项\n\n- 第二项\n\n  第二项的第二段\n\n- 第三项\n\n列表后\n",
  "nested ordered list with code": `1. 步骤一\n   ${fence}sh\n   bun install\n\n   bun run dev\n   ${fence}\n2. 步骤二\n   - 子项\n   - 子项\n\n结束\n`,
  "block quote with blank quoted lines": "> 引用第一段\n>\n> 引用第二段\n>\n> > 嵌套引用\n\n正文\n",
  "headings of every level": "# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n\n###### 六\n\nSetext 标题\n===\n\n正文\n",
  "html blocks and comments": "<div align=\"center\">\n\n<img src=\"a.png\">\n\n</div>\n\n<!-- 注释 -->\n\n段落 <kbd>Ctrl</kbd>\n",
  "definitions and footnotes": "见[文档][doc]和脚注[^1]。\n\n[doc]: https://example.com/doc \"标题\"\n\n[^1]: 脚注内容\n\n    脚注第二段\n",
  "thematic breaks": "上\n\n---\n\n中\n\n***\n\n下\n",
  "CRLF line endings": "# 标题\r\n\r\n第一段\r\n\r\n- 项\r\n- 项\r\n\r\n结尾\r\n",
  "byte order mark": "\uFEFF# 标题\n\n第一段\n\n第二段\n",
  "tabs and trailing spaces": "段落一  \n硬换行\t\n\n\t缩进代码\n\n段落二   \n",
  "Japanese and emoji": "# 日本語のタイトル\n\nこんにちは、世界 🌏。\n\n👨‍👩‍👧 家族\n",
  "images with size fragments": "![图](https://cdn.example.com/images/2026/10/abcdefghijklmnop.jpg#small \"图注\")\n\n文字\n",
  "single very long paragraph": `${"很长的段落。".repeat(5000)}\n`,
};

describe("splitMarkdownForTranslation", () => {
  it("returns no segments for an empty or blank body", () => {
    expect(splitMarkdownForTranslation("")).toEqual([]);
    expect(splitMarkdownForTranslation("  \n\n\t\n")).toEqual([]);
  });

  it("defaults to 6000 characters per segment", () => {
    expect(TRANSLATION_SEGMENT_MAX_CHARS).toBe(6000);
    const paragraph = `${"字".repeat(2000)}\n\n`;
    // 每块 2002 个字符：两块 4004，三块 6006 超过 6000，所以两块一段
    expect(splitMarkdownForTranslation(paragraph.repeat(4))).toEqual([paragraph.repeat(2), paragraph.repeat(2)]);
  });

  describe.each(Object.entries(roundTripCases))("%s", (_name, markdown) => {
    it.each([1, 10, 40, 200, 6000, Number.POSITIVE_INFINITY])("joins back to the original with maxChars = %d", (maxChars) => {
      const segments = splitMarkdownForTranslation(markdown, maxChars);
      expect(segments.length).toBeGreaterThan(0);
      expect(segments.join("")).toBe(markdown);
      expect(segments.every((segment) => segment.length > 0)).toBe(true);
    });

    it("cuts only at top-level block boundaries", () => {
      const blocks = splitMarkdownForTranslation(markdown, 0);
      expect(blocks.join("")).toBe(markdown);
      // maxChars = 0 时每个顶层块单独成段（标题后面紧跟的块除外）：段数不会多于顶层块数
      expect(blocks.length).toBeLessThanOrEqual(topLevelTypes(markdown).length);
      // 每段重新解析得到的顶层块，正好是原文对应位置的那些块——没有块被切开
      expect(blocks.flatMap(topLevelTypes)).toEqual(topLevelTypes(markdown));
    });
  });

  it("keeps everything in one segment when it fits", () => {
    const markdown = roundTripCases["definitions and footnotes"] ?? "";
    expect(splitMarkdownForTranslation(markdown)).toEqual([markdown]);
  });

  it("gives whitespace between blocks to the preceding segment", () => {
    expect(splitMarkdownForTranslation("甲\n\n\n乙\n", 1)).toEqual(["甲\n\n\n", "乙\n"]);
    expect(splitMarkdownForTranslation("\n\n甲\n\n乙", 1)).toEqual(["\n\n甲\n\n", "乙"]);
  });

  it("restores the byte order mark offset when cutting", () => {
    expect(splitMarkdownForTranslation("\uFEFF甲\n\n乙\n\n丙", 1)).toEqual(["\uFEFF甲\n\n", "乙\n\n", "丙"]);
  });

  it("never splits a code fence that contains blank lines", () => {
    const code = `${fence}py\nprint(1)\n\n\n\nprint(2)\n${fence}\n`;
    const markdown = `前言\n\n${code}\n后记\n`;
    expect(splitMarkdownForTranslation(markdown, 5)).toEqual(["前言\n\n", `${code}\n`, "后记\n"]);
  });

  it("never splits lists, tables or block quotes", () => {
    const list = "- 一\n\n- 二\n\n- 三\n";
    const table = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const quote = "> 一\n>\n> 二\n";
    const segments = splitMarkdownForTranslation(`${list}\n${table}\n${quote}`, 1);
    expect(segments).toEqual([`${list}\n`, `${table}\n`, quote]);
  });

  it("puts an oversized block in a segment of its own", () => {
    const long = `${"长".repeat(7000)}\n\n`;
    const segments = splitMarkdownForTranslation(`短一\n\n${long}短二\n`);
    expect(segments).toEqual(["短一\n\n", long, "短二\n"]);
  });

  it("packs consecutive blocks greedily up to maxChars", () => {
    // 每块 4 个字符（"甲甲\n\n"）
    const segments = splitMarkdownForTranslation("甲甲\n\n乙乙\n\n丙丙\n\n丁丁\n\n戊戊", 8);
    expect(segments).toEqual(["甲甲\n\n乙乙\n\n", "丙丙\n\n丁丁\n\n", "戊戊"]);
    // 正好等于上限也放得下
    expect(splitMarkdownForTranslation("甲甲\n\n乙乙\n\n", 8)).toEqual(["甲甲\n\n乙乙\n\n"]);
  });

  it("moves trailing headings to the next segment, with the content below them", () => {
    // "正文正文\n\n" 6 个字符，"## 标\n\n" 6 个字符
    const markdown = "正文正文\n\n## 标\n\n### 小\n\n下面的内容\n";
    expect(splitMarkdownForTranslation(markdown, 18)).toEqual(["正文正文\n\n", "## 标\n\n### 小\n\n下面的内容\n"]);
  });

  it("counts the carried headings toward the next segment's size", () => {
    // 块长：6、6（标题）、5、4。标题挪到第二段后第二段已有 6 + 5 = 11，再放 4 就超过 12
    const markdown = "正文正文\n\n## 标\n\n后面一\n\n再后面\n";
    expect(splitMarkdownForTranslation(markdown, 12)).toEqual(["正文正文\n\n", "## 标\n\n后面一\n\n", "再后面\n"]);
  });

  it("keeps consecutive headings with the following block even when they overflow", () => {
    const markdown = "# 一\n\n## 二\n\n很长的正文很长的正文\n\n后面\n";
    expect(splitMarkdownForTranslation(markdown, 8)).toEqual(["# 一\n\n## 二\n\n很长的正文很长的正文\n\n", "后面\n"]);
  });

  it("lets a heading at the very end form the last segment", () => {
    expect(splitMarkdownForTranslation("正文正文\n\n## 结尾标题\n", 6)).toEqual(["正文正文\n\n", "## 结尾标题\n"]);
  });

  it("is deterministic", () => {
    const markdown = Object.values(roundTripCases).join("\n\n");
    expect(splitMarkdownForTranslation(markdown, 300)).toEqual(splitMarkdownForTranslation(markdown, 300));
  });

  describe("on generated documents", () => {
    // 简单的线性同余随机数：每次运行生成相同的文档，失败可复现
    function random(seed: number): () => number {
      let state = seed;
      return () => {
        state = (state * 1103515245 + 12345) % 2 ** 31;
        return state / 2 ** 31;
      };
    }
    const pieces = [
      "段落，带**强调**和[链接](https://example.com)。",
      "# 标题",
      "## 二级标题",
      `${fence}js\nconst x = 1;\n\nconsole.log(x);\n${fence}`,
      "- 甲\n- 乙\n\n- 丙",
      "| 列 | 列 |\n| --- | --- |\n| 1 | 2 |",
      "> 引用\n>\n> 第二段",
      "    缩进代码\n\n    更多",
      "<details>\n<summary>展开</summary>\n内容\n</details>",
      "---",
      "[ref]: https://example.com/ref",
      "[^n]: 脚注",
      "非常长的段落。".repeat(300),
    ];
    const separators = ["\n\n", "\n\n\n", "\n \n", "\r\n\r\n", "\n\n\t\n"];

    it.each(Array.from({ length: 40 }, (_, i) => i + 1))("round-trips and respects block boundaries (seed %d)", (seed) => {
      const next = random(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
      const count = 1 + Math.floor(next() * 30);
      let markdown = next() < 0.3 ? "\n" : "";
      for (let i = 0; i < count; i++) markdown += pick(pieces) + pick(separators);
      const maxChars = pick([1, 50, 200, 1000, 6000]);

      const segments = splitMarkdownForTranslation(markdown, maxChars);
      expect(segments.join("")).toBe(markdown);
      expect(segments.flatMap(topLevelTypes)).toEqual(topLevelTypes(markdown));
      segments.forEach((segment, i) => {
        const types = topLevelTypes(segment);
        const content = types.filter((type) => type !== "heading");
        // 超长的段只能是"（若干标题 +）一个块"
        if (segment.length > maxChars) expect(content.length).toBeLessThanOrEqual(1);
        // 除了最后一段和只有标题的段，段尾不是标题
        if (i < segments.length - 1 && content.length > 0) expect(types.at(-1)).not.toBe("heading");
      });
    });
  });
});

// ---------- 结构校验 ----------

const kinds = (issues: StructureIssue[]) => issues.map((issue) => issue.kind);

const source = [
  "# 用 Hono 写 API",
  "",
  "安装依赖，然后运行 `bun run dev`。参见[官方文档](https://hono.dev/docs)和 <https://github.com/honojs/hono>。",
  "",
  "![架构图](https://cdn.example.com/images/2026/10/abcdefghijklmnop.png#medium \"整体架构\")",
  "",
  `${fence}ts`,
  "// 注释保持中文",
  "const app = new Hono();",
  fence,
  "",
  "## 步骤",
  "",
  "1. 第一步[^1]",
  "2. 第二步，按 <kbd>Ctrl</kbd> + <kbd>C</kbd> 停止",
  "",
  "| 名称 | 说明 |",
  "| --- | --- |",
  "| `app` | 应用实例 |",
  "",
  "更多内容见[参考][ref]。",
  "",
  "[ref]: https://example.com/ref",
  "",
  "[^1]: 脚注说明。",
  "",
].join("\n");

const translation = [
  "# Writing an API with Hono",
  "",
  "Install dependencies, then run `bun run dev`. See the [official docs](https://hono.dev/docs) and <https://github.com/honojs/hono>.",
  "",
  "![Architecture](https://cdn.example.com/images/2026/10/abcdefghijklmnop.png#medium \"Overall architecture\")",
  "",
  `${fence}ts`,
  "// 注释保持中文",
  "const app = new Hono();",
  fence,
  "",
  "## Steps",
  "",
  "1. Step one[^1]",
  "2. Step two: press <kbd>Ctrl</kbd> + <kbd>C</kbd> to stop",
  "",
  "| Name | Description |",
  "| --- | --- |",
  "| `app` | The app instance |",
  "",
  "See the [reference][ref] for more.",
  "",
  "[ref]: https://example.com/ref",
  "",
  "[^1]: A footnote.",
  "",
].join("\n");

/** 在译文上做一次替换（替换的目标必须存在，防止测试悄悄失效） */
function edit(text: string, from: string, to: string): string {
  expect(text).toContain(from);
  return text.replace(from, to);
}

describe("checkTranslationStructure", () => {
  it("accepts a faithful translation", () => {
    expect(checkTranslationStructure(source, translation)).toEqual({ errors: [], warnings: [] });
  });

  it("accepts empty documents", () => {
    expect(checkTranslationStructure("", "")).toEqual({ errors: [], warnings: [] });
  });

  it("classifies every kind as either an error or a warning", () => {
    expect(structureErrorKinds.filter((kind) => (structureWarningKinds as readonly string[]).includes(kind))).toEqual([]);
  });

  describe("code blocks (errors)", () => {
    it("reports changed code", () => {
      const result = checkTranslationStructure(source, edit(translation, "// 注释保持中文", "// comments stay Chinese"));
      expect(result.errors).toEqual([
        { kind: "code_block_changed", message: "代码块的内容被改动（代码必须原样保留）", detail: "第 1 个代码块（ts）" },
      ]);
    });

    it("reports a changed language", () => {
      const result = checkTranslationStructure(source, edit(translation, `${fence}ts`, `${fence}js`));
      expect(result.errors).toEqual([{ kind: "code_block_changed", message: "代码块的语言被改动", detail: "第 1 个代码块（ts）：ts → js" }]);
    });

    it("reports a removed language", () => {
      const result = checkTranslationStructure(`${fence}sh\nls\n${fence}`, `${fence}\nls\n${fence}`);
      expect(result.errors.map((issue) => issue.detail)).toEqual(["第 1 个代码块（sh）：sh → 无"]);
    });

    it("reports which block changed by position", () => {
      const a = `${fence}\none\n${fence}\n\n文字\n\n${fence}\ntwo\n${fence}\n`;
      const result = checkTranslationStructure(a, a.replace("two", "zwei").replace("文字", "text"));
      expect(result.errors).toEqual([expect.objectContaining({ kind: "code_block_changed", detail: "第 2 个代码块" })]);
    });

    it("reports reordered code blocks", () => {
      const a = `${fence}\none\n${fence}\n\n${fence}\ntwo\n${fence}\n`;
      const b = `${fence}\ntwo\n${fence}\n\n${fence}\none\n${fence}\n`;
      expect(kinds(checkTranslationStructure(a, b).errors)).toEqual(["code_block_changed", "code_block_changed"]);
    });

    it("reports a missing code block once, as a count mismatch", () => {
      const result = checkTranslationStructure(source, edit(translation, `${fence}ts\n// 注释保持中文\nconst app = new Hono();\n${fence}\n`, ""));
      expect(result.errors).toEqual([{ kind: "code_block_count", message: "代码块数量不同（原文 1 个，译文 0 个）" }]);
    });

    it("checks indented code blocks", () => {
      const result = checkTranslationStructure("说明\n\n    中文代码\n", "Note\n\n    English code\n");
      expect(kinds(result.errors)).toEqual(["code_block_changed"]);
    });

    it("checks code inside lists and block quotes", () => {
      const a = `- 项\n\n  ${fence}\n  原样\n  ${fence}\n\n> ${fence}\n> 引用里的代码\n> ${fence}\n`;
      const b = `- item\n\n  ${fence}\n  verbatim\n  ${fence}\n\n> ${fence}\n> code in quote\n> ${fence}\n`;
      expect(kinds(checkTranslationStructure(a, b).errors)).toEqual(["code_block_changed", "code_block_changed"]);
    });

    it("ignores the fence style and the info string after the language", () => {
      expect(checkTranslationStructure(`${fence}ts title="示例"\nx\n${fence}`, "~~~ts title=\"Example\"\nx\n~~~").errors).toEqual([]);
    });
  });

  describe("images (errors)", () => {
    const url = "https://cdn.example.com/images/2026/10/abcdefghijklmnop.png#medium";

    it("allows translating the alt text and title", () => {
      expect(checkTranslationStructure(`![图](${url} "图注")`, `![Figure](${url} "Caption")`).errors).toEqual([]);
    });

    it("reports a changed size fragment as one missing and one extra image", () => {
      const result = checkTranslationStructure(source, edit(translation, "png#medium", "png#small"));
      expect(result.errors).toEqual([
        { kind: "image_missing", message: "译文缺少图片（或图片地址被改动）", detail: url },
        { kind: "image_extra", message: "译文多出图片地址", detail: url.replace("#medium", "#small") },
      ]);
    });

    it("reports a dropped fragment", () => {
      const result = checkTranslationStructure(`![a](${url})`, `![a](${url.replace("#medium", "")})`);
      expect(kinds(result.errors)).toEqual(["image_missing", "image_extra"]);
    });

    it("counts duplicates", () => {
      const result = checkTranslationStructure(`![a](x.png)\n\n![b](x.png)`, `![a](x.png)`);
      expect(result.errors).toEqual([expect.objectContaining({ kind: "image_missing", detail: "x.png" })]);
    });

    it("resolves reference-style images", () => {
      const a = "![图][logo]\n\n[logo]: logo.png";
      expect(checkTranslationStructure(a, "![Logo][logo]\n\n[logo]: logo.png").errors).toEqual([]);
      // 引用指向不存在的定义时退化成普通文字：图片少了一张
      expect(kinds(checkTranslationStructure(a, "![Logo][missing]\n\n[logo]: logo.png").errors)).toEqual(["image_missing"]);
    });
  });

  describe("links (errors)", () => {
    it("allows translating link text and reordering links", () => {
      const a = "[甲](https://a.example) 和 [乙](https://b.example)";
      expect(checkTranslationStructure(a, "[B](https://b.example) and [A](https://a.example)").errors).toEqual([]);
    });

    it("reports a changed destination", () => {
      const result = checkTranslationStructure(source, edit(translation, "https://hono.dev/docs", "https://hono.dev/en/docs"));
      expect(result.errors).toEqual([
        { kind: "link_missing", message: "译文缺少链接（或链接地址被改动）", detail: "https://hono.dev/docs" },
        { kind: "link_extra", message: "译文多出链接地址", detail: "https://hono.dev/en/docs" },
      ]);
    });

    it("counts autolinks", () => {
      const result = checkTranslationStructure(source, edit(translation, " and <https://github.com/honojs/hono>", ""));
      expect(result.errors).toEqual([expect.objectContaining({ kind: "link_missing", detail: "https://github.com/honojs/hono" })]);
    });

    it("counts bare URLs, www addresses and email addresses (GFM autolink literals), with GFM's own url", () => {
      expect(checkTranslationStructure("见 https://example.com/x", "See the site").errors).toEqual([
        expect.objectContaining({ kind: "link_missing", detail: "https://example.com/x" }),
      ]);
      expect(checkTranslationStructure("见 www.example.com", "See the site").errors).toEqual([
        expect.objectContaining({ kind: "link_missing", detail: "http://www.example.com" }),
      ]);
      expect(checkTranslationStructure("联系 a@example.com", "Contact me").errors).toEqual([
        expect.objectContaining({ kind: "link_missing", detail: "mailto:a@example.com" }),
      ]);
    });

    it("counts links inside headings, tables and footnotes, and images inside links", () => {
      const a = "# 见 https://a.com/h\n\n| 列 |\n| --- |\n| https://a.com/t |\n\n注[^1]\n\n[^1]: https://a.com/f\n\n[![图](x.png)](https://a.com/i)";
      const result = checkTranslationStructure(a, "# See\n\n| Col |\n| --- |\n| - |\n\nNote[^1]\n\n[^1]: Footnote\n\n[Figure](https://a.com/i)");
      expect(result.errors).toEqual([
        expect.objectContaining({ kind: "image_missing", detail: "x.png" }),
        expect.objectContaining({ kind: "link_missing", detail: "https://a.com/h" }),
        expect.objectContaining({ kind: "link_missing", detail: "https://a.com/t" }),
        expect.objectContaining({ kind: "link_missing", detail: "https://a.com/f" }),
      ]);
    });

    it("ignores URLs inside link text: that text may be translated", () => {
      expect(checkTranslationStructure("[https://a.com/x 的文档](https://a.com/x)", "[docs](https://a.com/x)").errors).toEqual([]);
    });

    const missingAndExtra = (missing: string, extra: string) => [
      { kind: "link_missing", message: "译文缺少链接（或链接地址被改动）", detail: missing },
      { kind: "link_extra", message: "译文多出链接地址", detail: extra },
    ];

    describe("faithful translations: readers of the translation get the links the author intended", () => {
      // 两个方向都成立：原文和译文的写法都不会让 GFM 把标点算进链接
      it.each<readonly [string, string, string]>([
        ...[".", ",", ";", ":", "!", "?", ")", "*", "_", "~", "'", '"'].map(
          (p) => [`ASCII ${p} after the URL`, `见 https://a.com/x${p}`, `See https://a.com/x${p}`] as const,
        ),
        ["different ASCII punctuation on each side", "见 https://a.com/x!", "See https://a.com/x;"],
        ["a Wikipedia URL with parentheses", "见 https://en.wikipedia.org/wiki/Foo_(bar)", "See https://en.wikipedia.org/wiki/Foo_(bar)."],
        ["an email address", "联系 a@b.com。", "Contact a@b.com."],
        ["an email address right after CJK text", "联系a@example.com。", "Contact a@example.com."],
        // GFM 在原文里也不把这些识别成链接（"19.2.0" 不是域名），译文放进行内代码不影响任何链接
        ["a package version", "安装 react@19.2.0 即可。", "Install `react@19.2.0`."],
        ["a scoped package version", "依赖 @blog/shared@1.0.0。", "Depends on `@blog/shared@1.0.0`."],
        ["a user at an IP address", "用 root@1.2.3.4 登录", "Log in as `root@1.2.3.4`"],
        // "&nbsp;" 字符引用：GFM 自己会去掉末尾的
        ["&nbsp; after the URL", "见 https://a.com/x&nbsp;", "See https://a.com/x&nbsp;"],
        ["a no-break space character after the URL", "见 https://a.com/x 后面", "See https://a.com/x below"],
      ])("accepts %s, in both directions", (_name, a, b) => {
        expect(checkTranslationStructure(a, b).errors).toEqual([]);
        expect(checkTranslationStructure(b, a).errors).toEqual([]);
      });

      // 原文里 GFM 把末尾的标点算进了裸网址（"https://a.com/x”。"），作者想要的是去掉标点的地址；译文给读者的正是它。
      // 反过来（把右边当原文、左边当译文）不成立：中文页面的读者会拿到带标点的坏链接，所以必须报错
      it.each<readonly [string, string, string, string]>([
        ["curly double quotes and a full stop", "详见“https://a.com/x”。", 'See "https://a.com/x".', "https://a.com/x”。"],
        ["curly single quotes", "见‘https://a.com/x’", "See 'https://a.com/x'", "https://a.com/x’"],
        ["an em dash", "地址——https://a.com/x——\n\n仅供参考", "The address - https://a.com/x -\n\nfor reference", "https://a.com/x——"],
        ["an ellipsis", "还有 https://a.com/x……", "And https://a.com/x...", "https://a.com/x……"],
        ["a full stop", "地址是 https://example.com。", "The address is https://example.com.", "https://example.com。"],
        ["a full-width comma", "见 https://example.com/x，\n然后继续。", "See https://example.com/x,\nthen continue.", "https://example.com/x，"],
        ["full-width parentheses", "官网（https://example.com）", "Website (https://example.com)", "https://example.com）"],
        ["full-width parentheses and a full stop", "官网（https://example.com）。", "Website (https://example.com).", "https://example.com）。"],
        ["lenticular brackets", "【https://a.com/x】", "[https://a.com/x]", "https://a.com/x】"],
        ["ASCII punctuation before the CJK character", "见 https://example.com/x.。", "See https://example.com/x.", "https://example.com/x.。"],
        ["full-width parentheses around a URL with parentheses", "（https://en.wikipedia.org/wiki/Foo_(bar)）", "(https://en.wikipedia.org/wiki/Foo_(bar))", "https://en.wikipedia.org/wiki/Foo_(bar)）"],
        ["percent-encoding", "见 https://zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87。", "See https://zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87.", "https://zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87。"],
        ["a www address", "访问 www.example.com/docs。", "Visit www.example.com/docs.", "http://www.example.com/docs。"],
        ["a bare URL written as an explicit link", "见 https://a.com/x。", "See [the docs](https://a.com/x).", "https://a.com/x。"],
        ["a bare URL written as an angle-bracket autolink", "见 https://a.com/x。", "See <https://a.com/x>.", "https://a.com/x。"],
        ["a www address written as an explicit link", "见 www.a.com。", "See [the site](http://www.a.com).", "http://www.a.com。"],
        ["&nbsp; and a full stop after the URL", "见 https://a.com/x&nbsp;。", "See https://a.com/x&nbsp;.", "https://a.com/x&nbsp;。"],
        ["a byte order mark at the start", "﻿详见 https://example.com。", "See https://example.com.", "https://example.com。"],
      ])("accepts %s (but not the other way round)", (_name, a, b, brokenInChinese) => {
        expect(checkTranslationStructure(a, b).errors).toEqual([]);
        expect(checkTranslationStructure(b, a).errors).toEqual(missingAndExtra(canonicalLinkUrl(brokenInChinese), brokenInChinese));
      });

      // 读者浏览器拿到的是 normalizeUri 之后的编码形式（和渲染器一样），写法不同、编码后相同的地址是同一个
      it.each<readonly [string, string, string]>([
        ["a space vs %20", "[文档](<https://a.com/a b>)", "[docs](https://a.com/a%20b)"],
        ["raw CJK vs percent-encoding in an explicit link", "[维基](https://a.com/汉字)", "[Wiki](https://a.com/%E6%B1%89%E5%AD%97)"],
        ["raw CJK vs percent-encoding in a bare URL", "见 https://a.com/汉字 。", "See https://a.com/%E6%B1%89%E5%AD%97."],
        ["a percent-encoded path that was decoded", "见 https://a.com/%E4%B8%AD", "See https://a.com/中"],
        ["raw CJK vs percent-encoding in an image", "![图](https://a.com/汉字.png#small)", "![Figure](https://a.com/%E6%B1%89%E5%AD%97.png#small)"],
        ["a character reference vs the character", "[x](https://a.com/?a=1&amp;b=2)", "[x](https://a.com/?a=1&b=2)"],
        ["a backslash escape vs the character", "[x](https://a.com/a\\_b)", "[x](https://a.com/a_b)"],
      ])("accepts %s", (_name, a, b) => {
        expect(checkTranslationStructure(a, b).errors).toEqual([]);
        expect(checkTranslationStructure(b, a).errors).toEqual([]);
      });

      it("shows addresses as written, not percent-encoded, in the detail", () => {
        expect(checkTranslationStructure("见 https://a.com/汉字", "See https://a.com/漢字").errors).toEqual(missingAndExtra("https://a.com/汉字", "https://a.com/漢字"));
      });
    });

    describe("changed links are caught: the translation's links are taken exactly as readers get them", () => {
      const U = "https://example.com/docs/guide";

      it.each([
        // GFM 把粘在网址后面的助词算进了链接：读者点开的是错的地址
        ["a particle glued to the URL", "详见 https://a.com/x。", "詳しくはhttps://a.com/xをご覧ください", "https://a.com/x", "https://a.com/xをご覧ください"],
        ["simplified → traditional characters in the path", "见 https://a.com/汉字", "See https://a.com/漢字", "https://a.com/汉字", "https://a.com/漢字"],
        ["a changed number after a CJK path segment", "见 https://a.com/文章/1。", "See https://a.com/文章/2.", "https://a.com/文章/1", "https://a.com/文章/2"],
        ["a URL extended past its end", "详见“https://a.com/x”。", 'See "https://a.com/xy".', "https://a.com/x", "https://a.com/xy"],
        ["a changed explicit destination", "[维基](https://zh.wikipedia.org/wiki/中文)", "[Wiki](https://zh.wikipedia.org/wiki/)", "https://zh.wikipedia.org/wiki/中文", "https://zh.wikipedia.org/wiki/"],
        ["a changed www address", "访问 www.example.com。", "Visit www.example.org.", "http://www.example.com", "http://www.example.org"],
        ["a different case in percent-encoding (a different string for the browser)", "[x](https://a.com/%E6%B1%89)", "[x](https://a.com/%e6%b1%89)", "https://a.com/%E6%B1%89", "https://a.com/%e6%b1%89"],
        // 译文里的裸网址后面紧跟全角标点 / 弯引号：GFM 把标点算进链接，读者拿到的是坏链接（不管原文怎么写）
        ["a Japanese full stop glued to the URL (source has a space)", `详见 ${U} 。`, `詳しくは ${U}。`, U, `${U}。`],
        ["a Japanese full stop glued to the URL (source glued too)", `详见 ${U}。`, `詳しくは ${U}。`, U, `${U}。`],
        ["a Japanese full stop kept by the translation", "地址是 https://example.com。", "アドレスは https://example.com。", "https://example.com", "https://example.com。"],
        ["an explicit link turned into a bare URL before a full stop", `详见[文档](${U})。`, `詳しくは ${U}。`, U, `${U}。`],
        ["an explicit link turned into a bare URL in corner brackets", `详见[文档](${U})。`, `「${U}」。`, U, `${U}」。`],
        ["a full stop inside an explicit destination", `详见[文档](${U})。`, `[ドキュメント](${U}。)`, U, `${U}。`],
        ["a full stop inside an angle-bracket autolink", `详见 <${U}>。`, `詳しくは <${U}。>`, U, `${U}。`],
        ["a closing curly quote after the URL", `详见 ${U} 。`, `See ${U}”.`, U, `${U}”`],
        ["curly quotes around the URL in English", "「https://a.com/x」 を参照", "See “https://a.com/x”", "https://a.com/x", "https://a.com/x”"],
        ["a full-width parenthesis after the URL", `详见 (${U})`, `詳しくは（${U}）`, U, `${U}）`],
        ["a full-width exclamation mark after the URL", `看 ${U} ！`, `見て ${U}！`, U, `${U}！`],
        ["a full stop glued to a www address", "访问 www.example.com 。", "www.example.com。", "http://www.example.com", "http://www.example.com。"],
        ["kana glued to a www address", "访问 www.example.com 即可", "www.example.comにアクセスしてください", "http://www.example.com", "http://www.example.comにアクセスしてください"],
        ["kana glued to a URL", `见 ${U} 。`, `${U}をご覧ください。`, U, `${U}をご覧ください。`],
        // 显式链接的地址末尾多了 / 少了字符：作者亲手写的地址原样比较，一个字符都不去掉
        ["a dropped trailing underscore", "[x](https://a.com/foo_)", "[x](https://a.com/foo)", "https://a.com/foo_", "https://a.com/foo"],
        ["a dropped trailing underscore after a byte order mark", "\uFEFF[x](https://a.com/foo_)", "[x](https://a.com/foo)", "https://a.com/foo_", "https://a.com/foo"],
        ["a dropped hashbang", "[x](https://a.com/#!)", "[x](https://a.com/#)", "https://a.com/#!", "https://a.com/#"],
        ["a dropped trailing parenthesis", "[x](https://a.com/foo\\))", "[x](https://a.com/foo)", "https://a.com/foo)", "https://a.com/foo"],
        ["a dropped trailing bracket", "[x](https://a.com/a])", "[x](https://a.com/a)", "https://a.com/a]", "https://a.com/a"],
        ["a dropped trailing question mark", "[x](https://a.com/search?)", "[x](https://a.com/search)", "https://a.com/search?", "https://a.com/search"],
        ["a dropped trailing emoji", "[x](https://a.com/🎉)", "[x](https://a.com/)", "https://a.com/🎉", "https://a.com/"],
        ["a dropped character reference", "[x](https://a.com/x&amp;copy;)", "[x](https://a.com/x)", "https://a.com/x&copy;", "https://a.com/x"],
        ["an added trailing full stop", "[x](https://a.com/x)", "[x](https://a.com/x.)", "https://a.com/x", "https://a.com/x."],
        // <自动链接> 也是作者亲手写的地址：尖括号里的标点原样保留
        ["punctuation inside an angle-bracket autolink in the source", "见 <https://a.com/x。>", "See https://a.com/x.", "https://a.com/x。", "https://a.com/x"],
      ])("reports %s", (_name, a, b, missing, extra) => {
        expect(checkTranslationStructure(a, b).errors).toEqual(missingAndExtra(missing, extra));
      });

      it.each([
        ["a full stop glued to the image URL", "![图](https://cdn.example.com/a.png)", "![図](https://cdn.example.com/a.png。)", "https://cdn.example.com/a.png", "https://cdn.example.com/a.png。"],
        ["a dropped trailing character in the image URL", "![图](https://cdn.example.com/a.png_)", "![Fig](https://cdn.example.com/a.png)", "https://cdn.example.com/a.png_", "https://cdn.example.com/a.png"],
      ])("reports %s", (_name, a, b, missing, extra) => {
        expect(checkTranslationStructure(a, b).errors).toEqual([
          { kind: "image_missing", message: "译文缺少图片（或图片地址被改动）", detail: missing },
          { kind: "image_extra", message: "译文多出图片地址", detail: extra },
        ]);
      });

      it("reports a www address that GFM no longer links (text right before www.)", () => {
        expect(checkTranslationStructure("详见 www.a.com。", "詳しくはwww.a.comをご覧ください").errors).toEqual([
          { kind: "link_missing", message: "译文缺少链接（或链接地址被改动）", detail: "http://www.a.com" },
        ]);
      });

      it("reports a URL moved into inline code: it is no longer a link", () => {
        const result = checkTranslationStructure("详见 https://a.com/x。", "See `https://a.com/x`.");
        expect(result.errors).toEqual([{ kind: "link_missing", message: "译文缺少链接（或链接地址被改动）", detail: "https://a.com/x" }]);
        expect(kinds(result.warnings)).toEqual(["inline_code_extra"]);
      });

      it("accepts a URL that was in inline code on both sides", () => {
        expect(checkTranslationStructure("运行 `curl https://a.com/x`。", "Run `curl https://a.com/x`.").errors).toEqual([]);
      });

      it("reports a dropped duplicate", () => {
        expect(checkTranslationStructure("见 https://a.com/x 和 https://a.com/x。", "See https://a.com/x.").errors).toEqual([
          { kind: "link_missing", message: "译文缺少链接（或链接地址被改动）", detail: "https://a.com/x" },
        ]);
      });

      it("reports a URL changed into another URL that is also in the source", () => {
        const result = checkTranslationStructure("旧 https://a.com/x ，新 https://a.com/x/evil 。", "Old https://a.com/x/evil, new https://a.com/x/evil.");
        expect(result.errors).toEqual(missingAndExtra("https://a.com/x", "https://a.com/x/evil"));
      });

      it("reports text glued to a URL in the source (GFM links the text too, so the source's link is already that long)", () => {
        // 原文里 "。" 后面紧跟文字：GFM 把 "。后面" 也算进了链接——两边的链接确实不同，作者可以在原文的网址后面加空格
        expect(checkTranslationStructure("见 https://a.com/x。后面", "See https://a.com/x. Below").errors).toEqual(
          missingAndExtra("https://a.com/x。后面", "https://a.com/x"),
        );
      });

      // 前面有没配对的 "[" 时，GFM 生成的裸网址链接没有位置信息，仍要按字面自动链接处理（去掉结尾标点）
      it.each([
        ["an unmatched [ earlier in the text", "数组 a[0 见 https://a.com/x。", "Array a[0 see https://a.com/x."],
        ["a bare URL inside unmatched brackets", "参考资料：[https://a.com/x]。", "References: [https://a.com/x]."],
        ["a bare URL inside bracketed text", "参见 [官网 https://a.com/x]。", "See [official site https://a.com/x]."],
      ])("accepts a bare URL after %s", (_name, a, b) => {
        expect(checkTranslationStructure(a, b).errors).toEqual([]);
      });

      it("never compares link text", () => {
        expect(checkTranslationStructure("[文字](https://a.com/x)", "[https://a.com/y](https://a.com/x)").errors).toEqual([]);
      });
    });

    describe("extra links", () => {
      const linkified = (detail: string) => ({
        kind: "link_linkified",
        message: "译文把原文里没有成为链接的网址变成了链接（原文里它紧挨着文字，GFM 没有识别），确认一下",
        detail,
      });

      // 原文里一串像网址的文字没被 GFM 识别成链接，译文把它变成了链接：只提醒
      it.each([
        ["a www address right after CJK text", "访问www.example.com，然后", "Visit www.example.com, then", "http://www.example.com"],
        ["a www address followed by CJK letters", "访问www.example.com即可", "Visit www.example.com.", "http://www.example.com"],
        ["a www address with a CJK path", "访问www.example.com/文档，然后", "Visit www.example.com/文档, then", "http://www.example.com/文档"],
        ["an upper-case www address", "访问WWW.EXAMPLE.COM，然后", "Visit WWW.EXAMPLE.COM, then", "http://WWW.EXAMPLE.COM"],
        ["a URL glued to a Latin letter", "Visithttps://a.com/x now", "Visit https://a.com/x now", "https://a.com/x"],
        ["an email address after a slash", "邮箱/me@example.com", "Mail me@example.com", "mailto:me@example.com"],
        ["the address written as an explicit link", "访问www.example.com，然后", "Visit [the site](http://www.example.com), then", "http://www.example.com"],
        ["a byte order mark at the start", "﻿访问www.example.com，然后", "Visit www.example.com, then", "http://www.example.com"],
      ])("only warns about %s that the translation linked", (_name, a, b, detail) => {
        expect(checkTranslationStructure(a, b)).toEqual({ errors: [], warnings: [linkified(detail)] });
      });

      it.each([
        ["a link that is nowhere in the source", "正文", "Body https://a.com/x", "https://a.com/x"],
        ["a different address than the unlinked text", "访问www.example.com，然后", "Visit www.example.org, then", "http://www.example.org"],
        ["a URL that was only in inline code", "运行 `curl https://a.com/x`", "Run `curl https://a.com/x` (https://a.com/x)", "https://a.com/x"],
        ["a URL that was only in link text", "[https://a.com/x 的文档](https://b.com)", "[docs](https://b.com) https://a.com/x", "https://a.com/x"],
        ["a URL with punctuation glued on", "访问www.example.com，然后", "www.example.comへ。", "http://www.example.comへ。"],
        // 原文里网址后面粘着文字、译文原样照抄：渲染出的地址带着"即可"，是坏链接
        ["text glued after a www address, copied verbatim", "访问www.a.com即可", "www.a.com即可", "http://www.a.com即可"],
        ["text glued after a CJK path and punctuation, copied verbatim", "访问www.example.com/文档，然后", "見て www.example.com/文档，然后", "http://www.example.com/文档，然后"],
      ])("reports %s as an error", (_name, a, b, detail) => {
        expect(checkTranslationStructure(a, b).errors).toEqual([{ kind: "link_extra", message: "译文多出链接地址", detail }]);
      });
    });

    describe("reference links", () => {
      it("resolves reference links through their definitions", () => {
        const result = checkTranslationStructure(source, edit(translation, "[ref]: https://example.com/ref", "[ref]: https://example.com/other"));
        expect(result.errors).toEqual([
          expect.objectContaining({ kind: "link_missing", detail: "https://example.com/ref" }),
          expect.objectContaining({ kind: "link_extra", detail: "https://example.com/other" }),
        ]);
      });

      it("reports a reference that no longer resolves", () => {
        const result = checkTranslationStructure(source, edit(translation, "[reference][ref]", "[reference][reference]"));
        expect(result.errors).toEqual([expect.objectContaining({ kind: "link_missing", detail: "https://example.com/ref" })]);
      });

      it("counts every use of a definition", () => {
        const a = "[甲][d] 和 [乙][d]\n\n[d]: https://d.example";
        expect(kinds(checkTranslationStructure(a, "[A][d]\n\n[d]: https://d.example").errors)).toEqual(["link_missing"]);
      });

      it("matches reference labels case-insensitively", () => {
        expect(checkTranslationStructure("[文][Doc]\n\n[doc]: /d", "[text][DOC]\n\n[Doc]: /d").errors).toEqual([]);
      });

      it("resolves duplicate labels to the first definition, as renderers do", () => {
        const result = checkTranslationStructure("[文][a]\n\n[a]: /first\n\n[a]: /second", "[text][a]\n\n[a]: /second\n\n[a]: /first");
        expect(result.errors).toEqual([
          expect.objectContaining({ kind: "link_missing", detail: "/first" }),
          expect.objectContaining({ kind: "link_extra", detail: "/second" }),
        ]);
      });

      it("ignores an unused definition: readers get no link from it", () => {
        expect(checkTranslationStructure("正文\n\n[unused]: https://u.example", "Body\n").errors).toEqual([]);
      });

      it("accepts a reference link translated into an inline link to the same address", () => {
        expect(checkTranslationStructure("见[文档][d]\n\n[d]: https://d.example", "See the [docs](https://d.example).").errors).toEqual([]);
      });
    });

    it("stays fast on pathological input (no regex scanning, linear normalization and unlinked-URL scan)", () => {
      const n = 200_000;
      for (const text of [
        `见 ${"a".repeat(n)}`,
        `见 https://a.com/${")".repeat(n)}`,
        `见 https://a.com/x${" ".repeat(n)}y`,
        // 没被识别成链接的网址：一长串起点、一长串 @、网址后面一长串汉字和全角标点
        `见${"www.".repeat(n / 4)}`,
        `见${"a".repeat(n / 2)}${"@".repeat(n / 2)}`,
        `见www.a${"汉，".repeat(n / 2)}`,
      ]) {
        const started = Date.now();
        checkTranslationStructure(text, text);
        expect(Date.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
      }
    });
  });

  describe("HTML (errors)", () => {
    it("allows moving inline HTML within a sentence", () => {
      expect(checkTranslationStructure("按 <kbd>Ctrl</kbd> 键", "<kbd>Ctrl</kbd> を押す").errors).toEqual([]);
    });

    it("reports changed inline HTML", () => {
      const result = checkTranslationStructure(source, edit(translation, "<kbd>C</kbd>", "<kbd class=\"x\">C</kbd>"));
      expect(result.errors).toEqual([
        { kind: "html_missing", message: "译文缺少 HTML（或 HTML 被改动）", detail: "<kbd>" },
        { kind: "html_extra", message: "译文多出 HTML", detail: "<kbd class=\"x\">" },
      ]);
    });

    it("requires HTML blocks verbatim, including text inside them", () => {
      const result = checkTranslationStructure("<p align=\"center\">\n居中\n</p>\n", "<p align=\"center\">\nCentered\n</p>\n");
      expect(kinds(result.errors)).toEqual(["html_missing", "html_extra"]);
    });

    it("counts HTML comments", () => {
      expect(kinds(checkTranslationStructure("<!-- 备注 -->\n\n正文", "Body").errors)).toEqual(["html_missing"]);
    });

    it("truncates long HTML in the detail", () => {
      const html = `<div data-x="${"a".repeat(100)}">`;
      const [issue] = checkTranslationStructure(`${html}\n内容\n</div>`, "").errors;
      expect(issue?.detail).toHaveLength(81);
      expect(issue?.detail?.endsWith("…")).toBe(true);
    });
  });

  describe("footnotes (errors)", () => {
    it("reports a removed reference", () => {
      const result = checkTranslationStructure(source, edit(translation, "Step one[^1]", "Step one"));
      expect(result.errors).toEqual([{ kind: "footnote_missing", message: "译文缺少脚注", detail: "[^1]" }]);
    });

    it("reports a removed definition", () => {
      const result = checkTranslationStructure("正文[^a]\n\n[^a]: 说明\n\n[^b]: 未引用的脚注\n", "Body[^a]\n\n[^a]: Note\n");
      expect(result.errors).toEqual([expect.objectContaining({ kind: "footnote_missing", detail: "[^b]:" })]);
    });

    it("reports a renamed identifier", () => {
      const result = checkTranslationStructure("正文[^1]\n\n[^1]: 说明", "Body[^note]\n\n[^note]: Note");
      expect(result.errors).toEqual([
        expect.objectContaining({ kind: "footnote_missing", detail: "[^1]" }),
        expect.objectContaining({ kind: "footnote_missing", detail: "[^1]:" }),
        expect.objectContaining({ kind: "footnote_extra", detail: "[^note]" }),
        expect.objectContaining({ kind: "footnote_extra", detail: "[^note]:" }),
      ]);
    });
  });

  describe("warnings", () => {
    it("reports changed heading levels", () => {
      const result = checkTranslationStructure(source, edit(translation, "## Steps", "### Steps"));
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([{ kind: "heading_mismatch", message: "标题的数量或层级不同", detail: "原文 h1 h2；译文 h1 h3" }]);
    });

    it("reports a missing heading", () => {
      const result = checkTranslationStructure("## 甲\n\n文字", "Text");
      expect(result.warnings).toEqual([expect.objectContaining({ kind: "heading_mismatch", detail: "原文 h2；译文 无" })]);
    });

    it("reports changed inline code", () => {
      const result = checkTranslationStructure(source, edit(translation, "`bun run dev`", "`bun dev`"));
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([
        { kind: "inline_code_missing", message: "译文缺少行内代码（或行内代码被改动）", detail: "bun run dev" },
        { kind: "inline_code_extra", message: "译文多出行内代码", detail: "bun dev" },
      ]);
    });

    it("reports a missing table", () => {
      const result = checkTranslationStructure(source, edit(translation, "| Name | Description |\n| --- | --- |\n| `app` | The app instance |\n\n", ""));
      expect(result.errors).toEqual([]);
      expect(kinds(result.warnings)).toEqual(["inline_code_missing", "table_count"]);
      expect(result.warnings[1]?.message).toBe("表格数量不同（原文 1 个，译文 0 个）");
    });

    it("reports a different number of list items", () => {
      const result = checkTranslationStructure("- 甲\n- 乙\n- 丙", "- A\n- B, C");
      expect(result.warnings).toEqual([{ kind: "list_item_count", message: "列表项数量不同（原文 3 个，译文 2 个）" }]);
    });

    it("tolerates small differences in the number of paragraphs", () => {
      const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `段落 ${i}`).join("\n\n");
      // 原文 10 段：差 2 段（= 上限 max(2, 10 × 0.2)）不提醒，差 3 段提醒
      expect(checkTranslationStructure(paragraphs(10), paragraphs(8)).warnings).toEqual([]);
      expect(checkTranslationStructure(paragraphs(10), paragraphs(12)).warnings).toEqual([]);
      expect(checkTranslationStructure(paragraphs(10), paragraphs(7)).warnings).toEqual([
        { kind: "paragraph_count", message: "段落数相差较多（原文 10 段，译文 7 段），可能有漏译" },
      ]);
      // 原文 20 段：上限是 20 × 0.2 = 4
      expect(checkTranslationStructure(paragraphs(20), paragraphs(16)).warnings).toEqual([]);
      expect(kinds(checkTranslationStructure(paragraphs(20), paragraphs(15)).warnings)).toEqual(["paragraph_count"]);
      // 原文很短时至少允许差 2 段
      expect(checkTranslationStructure(paragraphs(1), paragraphs(3)).warnings).toEqual([]);
      expect(kinds(checkTranslationStructure(paragraphs(1), paragraphs(4)).warnings)).toEqual(["paragraph_count"]);
    });
  });

  it("checks a long document assembled from translated segments", () => {
    const longSource = Array.from({ length: 50 }, () => source).join("\n");
    const segments = splitMarkdownForTranslation(longSource, 2000);
    expect(segments.length).toBeGreaterThan(1);
    // 模拟逐段翻译：每段原文对应一段"译文"，拼起来再校验
    const translated = segments.map((segment) => segment.replaceAll(source, translation)).join("");
    expect(checkTranslationStructure(longSource, translated).errors).toEqual([]);
  });
});

// ---------- schema ----------

const sourceHash = "a".repeat(64);

describe("translationGenerateInputSchema", () => {
  it("accepts a title request", () => {
    expect(translationGenerateInputSchema.parse({ part: "title", sourceHash })).toEqual({ part: "title", sourceHash });
  });

  it("accepts a body segment request", () => {
    expect(translationGenerateInputSchema.parse({ part: "body", index: 0, sourceHash })).toEqual({ part: "body", index: 0, sourceHash });
    expect(translationGenerateInputSchema.parse({ part: "body", index: 12, sourceHash })).toMatchObject({ index: 12 });
  });

  it.each([
    ["a body request without index", { part: "body", sourceHash }],
    ["a negative index", { part: "body", index: -1, sourceHash }],
    ["a fractional index", { part: "body", index: 1.5, sourceHash }],
    ["a string index", { part: "body", index: "1", sourceHash }],
    ["an index on a title request", { part: "title", index: 0, sourceHash }],
    ["an unknown part", { part: "excerpt", sourceHash }],
    ["a missing part", { index: 0, sourceHash }],
    ["a missing source hash", { part: "title" }],
    ["an invalid source hash", { part: "title", sourceHash: "abc" }],
    ["unknown fields", { part: "body", index: 0, sourceHash, locale: "en" }],
  ])("rejects %s", (_name, value) => {
    expect(translationGenerateInputSchema.safeParse(value).success).toBe(false);
  });
});

const usage = { inputTokens: 1200, outputTokens: 800, cacheReadInputTokens: 1000, cacheCreationInputTokens: 0 };

describe("translationStreamEventSchema", () => {
  it.each([
    { type: "ping" },
    { type: "delta", text: "Hello" },
    { type: "delta", text: "" },
    { type: "done", text: "Hello world", stopReason: "end_turn", model: "claude-sonnet-5-5", usage },
    { type: "done", text: "", stopReason: "refusal", model: "claude-sonnet-5-5", usage },
    { type: "error", code: "internal_error", message: "上游出错" },
    { type: "error", code: "rate_limited", message: "太频繁" },
  ])("accepts %j", (event) => {
    expect(translationStreamEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    ["an unknown type", { type: "pong" }],
    ["a model name over the length limit", { type: "done", text: "x", stopReason: "end_turn", model: "m".repeat(101), usage }],
    ["a delta without text", { type: "delta" }],
    ["a done event without usage", { type: "done", text: "x", stopReason: "end_turn", model: "m" }],
    ["a done event without stop reason", { type: "done", text: "x", stopReason: "", model: "m", usage }],
    ["negative token counts", { type: "done", text: "x", stopReason: "end_turn", model: "m", usage: { ...usage, outputTokens: -1 } }],
    ["null cache counts", { type: "done", text: "x", stopReason: "end_turn", model: "m", usage: { ...usage, cacheReadInputTokens: null } }],
    ["an unknown error code", { type: "error", code: "overloaded", message: "x" }],
  ])("rejects %s", (_name, event) => {
    expect(translationStreamEventSchema.safeParse(event).success).toBe(false);
  });
});

describe("translationTitleResultSchema", () => {
  it("accepts a title result", () => {
    const result = { title: "Writing an API with Hono", model: "claude-sonnet-5-5", usage };
    expect(translationTitleResultSchema.parse(result)).toEqual(result);
  });

  it.each([
    ["an empty title", { title: "", model: "m", usage }],
    ["a missing model", { title: "x", usage }],
    ["missing usage", { title: "x", model: "m" }],
    ["a model name over the length limit", { title: "x", model: "m".repeat(101), usage }],
  ])("rejects %s", (_name, value) => {
    expect(translationTitleResultSchema.safeParse(value).success).toBe(false);
  });
});

describe("translationConfigSchema", () => {
  it.each([
    { available: true, model: "claude-sonnet-5-5" },
    { available: false, model: "claude-sonnet-5-5", reason: "not_configured" },
    { available: false, model: "claude-sonnet-5-5", reason: "rate_limiter_unavailable" },
  ])("accepts %o", (value) => {
    expect(translationConfigSchema.parse(value)).toEqual(value);
  });

  it.each([
    ["an empty model", { available: true, model: "" }],
    ["a missing model", { available: true }],
    ["a non-boolean available", { available: "yes", model: "m" }],
    ["unavailable without a reason", { available: false, model: "m" }],
    ["an unknown reason", { available: false, model: "m", reason: "maintenance" }],
  ])("rejects %s", (_name, value) => {
    expect(translationConfigSchema.safeParse(value).success).toBe(false);
  });

  it("drops a reason sent along with available: true", () => {
    expect(translationConfigSchema.parse({ available: true, model: "m", reason: "not_configured" })).toEqual({ available: true, model: "m" });
  });
});

describe("fitModelName", () => {
  it("leaves normal model IDs alone, apart from surrounding whitespace", () => {
    expect(fitModelName("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(fitModelName(" claude-sonnet-5-5\n")).toBe("claude-sonnet-5-5");
    expect(fitModelName("m".repeat(100))).toBe("m".repeat(100));
  });

  it("truncates an overlong name to the limit, ending in an ellipsis", () => {
    expect(fitModelName("m".repeat(101))).toBe(`${"m".repeat(99)}…`);
    expect(fitModelName("m".repeat(500))).toHaveLength(100);
  });
});

describe("combineModelNames", () => {
  it("de-duplicates in order of first appearance", () => {
    expect(combineModelNames(["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5-5"])).toBe("claude-sonnet-5-5, claude-opus-5-5");
    expect(combineModelNames(["claude-sonnet-5-5"])).toBe("claude-sonnet-5-5");
  });

  it("keeps whole names that fit and marks the rest with an ellipsis, so the result is always a valid generated.model", () => {
    const models = Array.from({ length: 10 }, (_, i) => `claude-fallback-model-${i}`);
    const combined = combineModelNames(models);
    expect(combined).toBe("claude-fallback-model-0, claude-fallback-model-1, claude-fallback-model-2, …");
    expect(combined.length).toBeLessThanOrEqual(100);
    expect(translationInputSchema.safeParse({ title: "t", contentMd: "c", sourceHash, generated: { model: combined } }).success).toBe(true);
  });

  it("is exactly at the limit when everything fits", () => {
    const a = "a".repeat(48);
    const b = "b".repeat(50);
    expect(combineModelNames([a, b])).toBe(`${a}, ${b}`);
    expect(combineModelNames([a, `${b}x`])).toBe(`${a}, …`);
  });

  it("truncates a single overlong name", () => {
    expect(combineModelNames(["m".repeat(150)])).toBe(`${"m".repeat(99)}…`);
    expect(combineModelNames(["m".repeat(150), "m".repeat(150)])).toBe(`${"m".repeat(99)}…`);
  });

  it("keeps the more-models marker when the first name is too long for it, by truncating that name", () => {
    expect(combineModelNames(["m".repeat(150), "claude-sonnet-5-5"])).toBe(`${"m".repeat(96)}…, …`);
    // 第一个名字本身没超长（98 个字符），但放不下 ", …"
    expect(combineModelNames(["m".repeat(98), "claude-sonnet-5-5"])).toBe(`${"m".repeat(96)}…, …`);
    // 正好放得下 ", …" 时不截断
    expect(combineModelNames(["m".repeat(97), "claude-sonnet-5-5"])).toBe(`${"m".repeat(97)}, …`);
    for (const length of [97, 98, 99, 100, 101, 500]) {
      const combined = combineModelNames(["m".repeat(length), "claude-sonnet-5-5"]);
      expect(combined.length).toBeLessThanOrEqual(100);
      expect(combined.endsWith(", …")).toBe(true);
    }
  });
});

describe("canonicalLinkUrl", () => {
  it.each<readonly [string, string]>([
    ["https://example.com", "https://example.com"],
    ["https://example.com/?q=1&r=2#top", "https://example.com/?q=1&r=2#top"],
    // 非 ASCII 的标点、符号、分隔符：弯引号、全角括号和方括号、句号、逗号、顿号、破折号、省略号、NBSP、全角空格
    ["https://a.com/x”。", "https://a.com/x"],
    ["https://a.com/x’", "https://a.com/x"],
    ["https://a.com/x」", "https://a.com/x"],
    ["https://a.com/x】", "https://a.com/x"],
    ["https://a.com/x）", "https://a.com/x"],
    ["https://a.com/x，", "https://a.com/x"],
    ["https://a.com/x、", "https://a.com/x"],
    ["https://a.com/x——", "https://a.com/x"],
    ["https://a.com/x……", "https://a.com/x"],
    ["https://a.com/x ", "https://a.com/x"],
    ["https://a.com/x　", "https://a.com/x"],
    ["https://a.com/x→", "https://a.com/x"],
    ["https://a.com/x👉", "https://a.com/x"],
    // ASCII 的 ?!.,:;*_~'"，字符引用
    ...[..."?!.,:;*_~'\""].map((p) => [`https://a.com/x${p}`, "https://a.com/x"] as const),
    ["https://a.com/x!?.", "https://a.com/x"],
    ["https://a.com/x&nbsp;", "https://a.com/x"],
    ["https://a.com/x&nbsp;。", "https://a.com/x"],
    // 只有具名的（& + ASCII 字母 + ;）整个去掉，和 GFM 一样；其他的只去掉分号
    ["https://a.com/x&#160;", "https://a.com/x&#160"],
    ["https://a.com/x&a1;", "https://a.com/x&a1"],
    ["https://a.com/x&;", "https://a.com/x&"],
    ["https://a.com/x&a-b;", "https://a.com/x&a-b"],
    // 括号：不配对的去掉，配对的保留
    ["https://a.com/x)", "https://a.com/x"],
    ["https://a.com/x]", "https://a.com/x"],
    ["https://a.com/x))", "https://a.com/x"],
    ["https://en.wikipedia.org/wiki/Foo_(bar)", "https://en.wikipedia.org/wiki/Foo_(bar)"],
    ["https://en.wikipedia.org/wiki/Foo_(bar))", "https://en.wikipedia.org/wiki/Foo_(bar)"],
    ["https://en.wikipedia.org/wiki/Foo_(bar)）。", "https://en.wikipedia.org/wiki/Foo_(bar)"],
    ["https://a.com/[x]", "https://a.com/[x]"],
    ["https://a.com/x(", "https://a.com/x("],
    // 末尾的非 ASCII 字母、数字、附加符号保留；中间的一切保留
    ["https://a.com/汉字", "https://a.com/汉字"],
    ["https://a.com/漢字", "https://a.com/漢字"],
    ["https://a.com/xをご覧ください", "https://a.com/xをご覧ください"],
    ["https://a.com/カタカナー", "https://a.com/カタカナー"],
    ["https://a.com/한국어", "https://a.com/한국어"],
    ["https://a.com/café", "https://a.com/café"],
    ["https://a.com/café", "https://a.com/café"],
    ["https://a.com/x①", "https://a.com/x①"],
    ["https://a.com/x。后面", "https://a.com/x。后面"],
    ["https://a.com/x、https://b.com/y", "https://a.com/x、https://b.com/y"],
    // 不做百分号解码；其余 ASCII 原样保留
    ["https://zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87。", "https://zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87"],
    ["https://a.com/x%", "https://a.com/x%"],
    ["https://a.com/x/", "https://a.com/x/"],
    ["https://a.com/x#", "https://a.com/x#"],
    ["https://a.com/x=", "https://a.com/x="],
    ["x.png#small", "x.png#small"],
    ["mailto:a@b.com", "mailto:a@b.com"],
    ["", ""],
    ["。", ""],
    // 孤立的代理项不是标点，保留
    ["https://a.com/x\uD800", "https://a.com/x\uD800"],
  ])("%j → %j", (url, expected) => {
    expect(canonicalLinkUrl(url)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const url of ["https://a.com/x”。", "https://en.wikipedia.org/wiki/Foo_(bar))", "https://a.com/x&nbsp;。", "https://a.com/x"]) {
      expect(canonicalLinkUrl(canonicalLinkUrl(url))).toBe(canonicalLinkUrl(url));
    }
  });

  it.each([
    ["a long ASCII token", `https://a.com/${"a".repeat(200_000)}`, `https://a.com/${"a".repeat(200_000)}`],
    ["a long run of closing parentheses", `https://a.com/${")".repeat(200_000)}`, "https://a.com/"],
    ["a long run of spaces", `https://a.com/x${" ".repeat(200_000)}`, `https://a.com/x${" ".repeat(200_000)}`],
    ["a long run of full stops", `https://a.com/x${"。".repeat(200_000)}`, "https://a.com/x"],
    ["a long run of semicolons after letters", `https://a.com/${"a;".repeat(100_000)}`, `https://a.com/${"a;".repeat(99_999)}a`],
    ["a long run of character references", `https://a.com/x${"&nbsp;".repeat(50_000)}`, "https://a.com/x"],
  ])("runs in linear time on %s", (_name, url, expected) => {
    const started = Date.now();
    expect(canonicalLinkUrl(url)).toBe(expected);
    expect(Date.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});

describe("fitTranslatedSegment", () => {
  it("gives the translation the source segment's trailing blank lines, so segments join into a whole", () => {
    expect(fitTranslatedSegment("段落。\n\n", "A paragraph.")).toBe("A paragraph.\n\n");
    expect(fitTranslatedSegment("段落。\n\n", "A paragraph.\n")).toBe("A paragraph.\n\n");
    expect(fitTranslatedSegment("最后一段。", "Last one.\n\n")).toBe("Last one.");
    expect(fitTranslatedSegment("段落。\n\n\n", "Para.  \n \n")).toBe("Para.\n\n\n");
    expect(fitTranslatedSegment("第一段\n\n", "\n\nFirst")).toBe("First\n\n");
  });

  it("keeps a following indented code block from merging into the paragraph", () => {
    const segments = splitMarkdownForTranslation("段落\n\n    code\n", 3);
    expect(segments).toEqual(["段落\n\n", "    code\n"]);
    expect(fitTranslatedSegment(segments[0] ?? "", "Paragraph") + fitTranslatedSegment(segments[1] ?? "", "    code")).toBe("Paragraph\n\n    code\n");
  });

  it("only moves whole blank lines at the start: indentation can belong to a code block", () => {
    expect(fitTranslatedSegment("\n\n    code\n", "    code")).toBe("\n\n    code\n");
    expect(fitTranslatedSegment("    code\n", "\n    code\n")).toBe("    code\n");
    expect(fitTranslatedSegment("段落。\n", "  Indented.")).toBe("  Indented.\n");
  });

  it("handles CRLF line endings", () => {
    expect(fitTranslatedSegment("\r\n段落。\r\n\r\n", "\r\nPara.")).toBe("\r\nPara.\r\n\r\n");
    expect(fitTranslatedSegment("\r\n段落。\r\n", "Para.")).toBe("\r\nPara.\r\n");
  });

  it("treats full-width spaces and NBSP as content, on both sides", () => {
    // 原文段末尾的全角空格是内容，不是块之间的空白：不能带进译文
    expect(fitTranslatedSegment("段落　\n\n", "Paragraph")).toBe("Paragraph\n\n");
    // 译文自己末尾的全角空格也是内容：不能删
    expect(fitTranslatedSegment("段落\n\n", "日本語　")).toBe("日本語　\n\n");
    expect(fitTranslatedSegment("文\n", "テキスト\u00A0")).toBe("テキスト\u00A0\n");
  });

  it("trims in linear time, even around a long run of whitespace inside the text", () => {
    const spaces = " ".repeat(200_000);
    const started = Date.now();
    expect(fitTranslatedSegment("段落。\n\n", `A${spaces}B${spaces}`)).toBe(`A${spaces}B\n\n`);
    expect(fitTranslatedSegment(`段落${spaces}x${spaces}\n`, `${spaces}\n${spaces}C`)).toBe(`${spaces}C${spaces}\n`);
    expect(fitTranslatedSegment(`\t${spaces}\n段落`, "\n\nD")).toBe(`\t${spaces}\nD`);
    expect(Date.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });

  it("keeps only blanks for an all-blank translation", () => {
    expect(fitTranslatedSegment("\n段落\n\n", " \n \t ")).toBe("\n\n\n");
    expect(fitTranslatedSegment("段落", "")).toBe("");
    expect(fitTranslatedSegment("段落\r", "x\r")).toBe("x\r");
    expect(fitTranslatedSegment("\r段落", "\rx")).toBe("\rx");
  });

  it("is idempotent: the editor fits again what the API already fitted", () => {
    for (const [sourceSegment, translated] of [
      ["段落　\n\n", "Paragraph \n"],
      ["\n\n段落\n\n", "\n日本語　"],
      ["    code\n", "\n    code"],
    ] as const) {
      const once = fitTranslatedSegment(sourceSegment, translated);
      expect(fitTranslatedSegment(sourceSegment, once)).toBe(once);
    }
  });
});

describe("translationUsageSchema", () => {
  const fields = Object.keys(usage) as (keyof typeof usage)[];

  it("accepts zero and positive integers", () => {
    expect(translationUsageSchema.parse({ ...usage, cacheCreationInputTokens: 0 })).toEqual({ ...usage, cacheCreationInputTokens: 0 });
  });

  it.each(fields.flatMap((field) => [-1, 1.5].map((value) => [field, value] as const)))("rejects %s = %d (in titles and stream events too)", (field, value) => {
    const bad = { ...usage, [field]: value };
    expect(translationUsageSchema.safeParse(bad).success).toBe(false);
    expect(translationTitleResultSchema.safeParse({ title: "x", model: "m", usage: bad }).success).toBe(false);
    expect(translationStreamEventSchema.safeParse({ type: "done", text: "x", stopReason: "end_turn", model: "m", usage: bad }).success).toBe(false);
  });
});

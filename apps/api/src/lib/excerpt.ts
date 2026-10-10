import { toString } from "mdast-util-to-string";
import { parseMarkdown, tidyText } from "./markdown-text.ts";

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

/**
 * 从 Markdown 生成纯文本摘要：只取段落（跳过标题、代码块、列表），
 * 按字素（grapheme）截断，不会把 emoji 或组合字符切成半个。
 */
export function excerptFromMarkdown(markdown: string, maxLength = 120): string {
  const text = tidyText(
    parseMarkdown(markdown)
      .children.filter((node) => node.type === "paragraph")
      .map((node) => toString(node))
      .join(" "),
  );

  const graphemes = Array.from(segmenter.segment(text), (s) => s.segment);
  if (graphemes.length <= maxLength) return text;
  return `${graphemes.slice(0, maxLength).join("").trimEnd()}…`;
}

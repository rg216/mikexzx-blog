import { toString } from "mdast-util-to-string";
import { parseMarkdown, tidyText } from "./markdown-text.ts";
import { wordSafeEnd } from "./word-boundary.ts";

// 字素切分与语言无关（Unicode 规则），一个 segmenter 供所有语言用
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

/**
 * 从 Markdown 生成纯文本摘要：只取段落（跳过标题、代码块、列表），
 * 按字素（grapheme）截断，不会把 emoji 或组合字符切成半个；也不会把英文单词切成半个。
 * maxLength 按语言取 localeInfo[locale].excerptLength（西文字符窄，同样的视觉长度需要更多字符）。
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
  return `${graphemes.slice(0, wordSafeEnd(graphemes, maxLength)).join("").trimEnd()}…`;
}

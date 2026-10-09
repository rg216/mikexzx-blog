import type { Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * 中文语境里多余的空白：全角标点前后（标点自带间距），以及两个汉字之间。
 * 汉字与西文之间的空格保留（"用 Hugo 写"）。需要 u 标志才能用 \p{...}。
 */
const EXTRA_CJK_SPACE =
  /(?<=[　-〿＀-￯])\s+|\s+(?=[　-〿＀-￯])|(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu;

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

/**
 * 从 Markdown 生成纯文本摘要：只取段落（跳过标题、代码块、列表），
 * 按字素（grapheme）截断，不会把 emoji 或组合字符切成半个。
 */
export function excerptFromMarkdown(markdown: string, maxLength = 120): string {
  const tree: Root = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const text = tree.children
    .filter((node) => node.type === "paragraph")
    .map((node) => toString(node))
    .join(" ")
    .replace(/\s+/g, " ")
    // 拼接段落、软换行会产生空格，中文里要去掉（"处理。 拉丁" → "处理。拉丁"）
    .replace(EXTRA_CJK_SPACE, "")
    .trim();

  const graphemes = Array.from(segmenter.segment(text), (s) => s.segment);
  if (graphemes.length <= maxLength) return text;
  return `${graphemes.slice(0, maxLength).join("").trimEnd()}…`;
}

import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * 中文语境里多余的空白：全角标点前后（标点自带间距），以及两个汉字之间。
 * 汉字与西文之间的空格保留（"用 Hugo 写"）。需要 u 标志才能用 \p{...}。
 */
const EXTRA_CJK_SPACE =
  /(?<=[　-〿＀-￯])\s+|\s+(?=[　-〿＀-￯])|(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu;
/** 只有全角标点前后的空格（块与块之间用） */
const SPACE_AROUND_FULLWIDTH = /(?<=[　-〿＀-￯]) | (?=[　-〿＀-￯])/gu;

export function parseMarkdown(markdown: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown);
}

/** 合并空白为单个空格，并去掉中文里多余的空格（拼接段落、软换行都会产生空格："处理。 拉丁" → "处理。拉丁"） */
export function tidyText(text: string): string {
  return text.replace(/\s+/g, " ").replace(EXTRA_CJK_SPACE, "").trim();
}

// 这些节点的子节点是行内内容，直接拼接；其余（列表、引用、表格行…）是块，之间要隔开。
// 否则 "**全**栈" 会被拆成 "全 栈"，而两个列表项 "foo" "bar" 又会粘成 "foobar"。
// 块之间先用一个私用区字符占位：它不算空白，不会被 tidyText 当作"汉字之间多余的空格"删掉。
const BLOCK_BREAK = "\uE000";
const INLINE_PARENTS = new Set<Nodes["type"]>(["paragraph", "heading", "tableCell", "emphasis", "strong", "delete", "link", "linkReference"]);

function textOf(node: Nodes): string {
  switch (node.type) {
    case "image":
    case "imageReference":
      return node.alt ?? "";
    // 原始 HTML 渲染时会被 sanitize 掉，不进索引
    case "html":
      return "";
    case "break":
      return " ";
  }
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(textOf).join(INLINE_PARENTS.has(node.type) ? "" : BLOCK_BREAK);
  return "";
}

/**
 * 全文的纯文本（标题、列表、代码、图片说明都算），用于搜索索引和搜索结果摘要。
 * 每个块各自整理，块之间留一个空格（"规则只有一条" 和下一段 "能外包的功能" 不会粘在一起），全角标点旁边除外。
 */
export function plainTextFromMarkdown(markdown: string): string {
  return textOf(parseMarkdown(markdown))
    .split(BLOCK_BREAK)
    .map(tidyText)
    .filter(Boolean)
    .join(" ")
    .replace(SPACE_AROUND_FULLWIDTH, "");
}

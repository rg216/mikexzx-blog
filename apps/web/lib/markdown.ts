import type { Root } from "mdast";
import { toString } from "mdast-util-to-string";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/*
 * Markdown → HTML 字符串。
 * 两层防护：remark-rehype 默认丢弃 Markdown 里的原始 HTML；
 * rehype-sanitize 再按 GitHub 同款白名单清洗（去掉 javascript: 链接、事件属性等）。
 * 现在内容只有作者自己写，但 v4 的评论会复用这条管线，所以从一开始就 sanitize。
 *
 * 输出字符串而不是 React 元素：字符串可以直接缓存/存库，渲染时用 dangerouslySetInnerHTML。
 * 代价是没法把 <img> 换成 next/image 之类的组件——需要时再换 hast-util-to-jsx-runtime。
 */
const htmlProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, {
    footnoteLabel: "脚注",
    footnoteBackLabel: (referenceIndex, rereferenceIndex) =>
      `回到正文第 ${referenceIndex + 1} 处引用${rereferenceIndex > 1 ? `（第 ${rereferenceIndex} 次）` : ""}`,
  })
  .use(rehypeSanitize, {
    ...defaultSchema,
    // id 前缀（防 DOM clobbering）已由 remark-rehype 加过（user-content-fn-1）；
    // sanitize 默认会再加一次，变成 user-content-user-content-fn-1，而 href 不变，脚注链接就断了。
    // 这里关掉第二次：原始 HTML 在上一步已被丢弃，用户写不出任意 id，带 id 的只有已加前缀的脚注。
    clobberPrefix: "",
  })
  .use(rehypeStringify);

export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await htmlProcessor.process(markdown);
  return String(file);
}

/**
 * 中文语境里多余的空白：全角标点前后（标点自带间距），以及两个汉字之间。
 * 汉字与西文之间的空格保留（"用 Hugo 写"）。需要 u 标志才能用 \p{...}。
 */
const EXTRA_CJK_SPACE =
  /(?<=[\u3000-\u303f\uff00-\uffef])\s+|\s+(?=[\u3000-\u303f\uff00-\uffef])|(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu;

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

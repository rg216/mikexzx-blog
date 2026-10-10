import type { Element, Root, RootContent } from "hast";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/*
 * 评论的 Markdown 渲染。和文章共用同一套 unified 管线，但白名单严格得多：评论是陌生人写的。
 *   - 只允许段落、强调、链接、行内代码、代码块、引用、列表；
 *   - 不允许图片：可以用来追踪读者（加载图片即向第三方暴露 IP）或贴大图刷屏；
 *   - 不允许标题、表格：评论里用不上，还会破坏页面层级——不在白名单里的标签只保留里面的文字。
 * 链接加 rel="nofollow ugc"：告诉搜索引擎这是用户生成的内容，别人在评论里塞链接得不到排名收益，垃圾评论也就少了动机。
 */
const commentSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: ["p", "br", "a", "strong", "em", "del", "code", "pre", "blockquote", "ul", "ol", "li"],
  attributes: { a: ["href"] },
  protocols: { href: ["http", "https", "mailto"] },
};

function addUgcRel(node: Root | RootContent): void {
  if (node.type === "element") {
    const element = node as Element;
    if (element.tagName === "a") element.properties = { ...element.properties, rel: ["nofollow", "ugc", "noopener", "noreferrer"] };
  }
  if ("children" in node) node.children.forEach(addUgcRel);
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, commentSchema)
  // 在 sanitize 之后加：rel 是我们加的可信属性
  .use(() => addUgcRel)
  .use(rehypeStringify)
  .freeze();

/** 同步渲染（管线里没有异步插件），评论组件拿到数据就能直接渲染 */
export function renderCommentMarkdown(markdown: string): string {
  return String(processor.processSync(markdown));
}

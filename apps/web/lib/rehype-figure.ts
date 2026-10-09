import type { Element, ElementContent, Root, RootContent } from "hast";

/**
 * rehype 插件：
 * 1. 单独成段的图片 `![alt](src "图注")` → `<figure><img><figcaption>图注</figcaption></figure>`，
 *    这样排版时可以让图片比正文宽（见 Prose.module.css 的 wide 栏）；
 * 2. 所有图片加 loading="lazy" / decoding="async"。
 *
 * 必须放在 rehype-sanitize 之后：figure/figcaption 是我们生成的可信结构，
 * 用户能控制的只有已被清洗过的 alt、title 文本，输出时还会再被转义。
 */
export function rehypeFigure() {
  return (tree: Root) => {
    tree.children = tree.children.map(toFigure);
    lazyLoadImages(tree);
  };
}

function isBlank(node: ElementContent): boolean {
  return node.type === "text" && node.value.trim() === "";
}

// 只处理顶层段落：列表、引用里的图片保持行内，不做出血。
function toFigure(node: RootContent): RootContent {
  if (node.type !== "element" || node.tagName !== "p") return node;

  const content = node.children.filter((child) => !isBlank(child));
  const [image] = content;
  if (content.length !== 1 || image?.type !== "element" || image.tagName !== "img") return node;

  // title 挪去做图注，不再留在 img 上（否则鼠标悬停会重复显示一遍）
  const { title, ...properties } = image.properties;
  const children: ElementContent[] = [{ ...image, properties }];
  if (typeof title === "string" && title.trim() !== "") {
    children.push({
      type: "element",
      tagName: "figcaption",
      properties: {},
      children: [{ type: "text", value: title.trim() }],
    });
  }

  return { type: "element", tagName: "figure", properties: {}, children };
}

function lazyLoadImages(node: Root | Element): void {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "img") {
      child.properties.loading = "lazy";
      child.properties.decoding = "async";
    }
    lazyLoadImages(child);
  }
}

import {
  IMAGE_DISPLAY_WIDTHS,
  type ImageDisplaySize,
  imageKeyOf,
  parseImageSize,
  type PostImageMeta,
  variantUrl,
} from "@blog/shared";
import type { Element, Root } from "hast";

/*
 * rehype 插件：处理正文里的每一张图片。
 *   1. 读地址里的显示尺寸（#small / #medium / #large / #w=320，见 @blog/shared 的 media.ts），从地址里去掉，
 *      记到 data-size（图片和外层 figure 上都记，样式和"手机上要不要贴满屏幕"都看它）；
 *   2. 媒体库的图片（参数 images 里有它的宽高）：加 width/height（加载前就占好位置，页面不跳动）、
 *      srcset + sizes（浏览器按屏幕宽度和像素密度挑合适的版本，手机不用下载 2560px 的原图），
 *      以及 --image-max（原始宽度，不放大）和 --image-ratio（宽高比，用来限制竖图的高度）；
 *   3. 自定义宽度写进 --display-max。
 * 宽度最终由 Prose.module.css 里的一条 min() 算出：不超过原始宽度、不超过显示尺寸、不超过栏宽、高度不超过视口的 80%。
 *
 * 必须放在 rehype-sanitize 之后：这里加的 style、srcset 都是可信的值，不能让用户在 Markdown 里写。
 */

/** sizes：告诉浏览器图片在页面上大约多宽（选版本用），按显示尺寸和断点（46rem ≈ 736px）给出 */
export function sizesFor(size: ImageDisplaySize | null, inFigure: boolean): string {
  if (size && "width" in size) return `(min-width: ${size.width}px) ${size.width}px, 100vw`;
  const preset = size?.preset ?? (inFigure ? "large" : "medium");
  if (preset === "small") return `${IMAGE_DISPLAY_WIDTHS.small}px`;
  return `(min-width: 46rem) ${IMAGE_DISPLAY_WIDTHS[preset]}px, 100vw`;
}

function sizeLabel(size: ImageDisplaySize | null): string | undefined {
  if (!size) return undefined;
  return "preset" in size ? size.preset : "custom";
}

function styleOf(...declarations: (string | false)[]): string | undefined {
  const style = declarations.filter(Boolean).join("; ");
  return style || undefined;
}

function processImage(img: Element, parent: Element | Root, images: Record<string, PostImageMeta>): void {
  const rawSrc = img.properties.src;
  if (typeof rawSrc !== "string") return;
  const { src, size } = parseImageSize(rawSrc);
  const inFigure = parent.type === "element" && parent.tagName === "figure";
  const label = sizeLabel(size);

  img.properties.src = src;
  if (label) {
    img.properties.dataSize = label;
    if (inFigure) (parent as Element).properties.dataSize = label;
  }

  const key = imageKeyOf(src);
  const meta = key ? images[key] : undefined;
  if (meta) {
    img.properties.width = meta.width;
    img.properties.height = meta.height;
    if (meta.variants.length > 0) {
      // srcset 里的地址一律去掉 #片段：srcset 用逗号和空格分隔候选项，无法识别的片段里若有这些字符会拆出额外的地址
      const bare = src.split("#")[0] ?? src;
      img.properties.srcSet = [...meta.variants.map((w) => `${variantUrl(bare, w)} ${w}w`), `${bare} ${meta.width}w`].join(", ");
      img.properties.sizes = sizesFor(size, inFigure);
    }
  }

  // 有了原始宽度和宽高比，样式就能直接算出宽度（见 Prose.module.css 的 [data-sized]）
  if (meta) img.properties.dataSized = "";
  img.properties.style = styleOf(
    meta !== undefined && `--image-max: ${meta.width}px`,
    meta !== undefined && `--image-ratio: ${meta.width} / ${meta.height}`,
    size !== null && "width" in size && `--display-max: ${size.width}px`,
  );
}

function walk(node: Root | Element, images: Record<string, PostImageMeta>): void {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "img") processImage(child, node, images);
    else walk(child, images);
  }
}

/** images：文章引用的媒体库图片信息，按原图 key 索引（API 随文章一起返回）；编辑器预览时没有，只处理显示尺寸 */
export function rehypeImages({ images = {} }: { images?: Record<string, PostImageMeta> } = {}) {
  return (tree: Root) => {
    walk(tree, images);
  };
}

/*
 * 媒体库图片在正文里的约定（编辑器写、渲染器读、API 统计引用，三方共用）。
 *
 * 1. 识别：正文里只存图片地址。地址里的 key（images/2026/10/<随机串>.jpg）全站唯一，
 *    按 key 而不是整个地址识别——以后图片换了域名（比如从 r2.dev 换成自定义域名），旧文章照样认得出来。
 * 2. 尺寸版本：上传时额外生成的小图与原图同名，加宽度后缀：<随机串>-640w.jpg。
 * 3. 显示尺寸：写在地址的 #片段里，如 ![描述](…/a.jpg#small)。片段不会发给服务器，
 *    别的 Markdown 渲染器会忽略它，图片照常显示；我们的渲染器读取后从地址里去掉。
 */

/** 生成的尺寸版本（宽度，px）。只生成比原图窄的 */
export const IMAGE_VARIANT_WIDTHS = [640, 1280, 1920] as const;
export type ImageVariantWidth = (typeof IMAGE_VARIANT_WIDTHS)[number];

/** 三档显示尺寸对应的最大宽度（px）：小 ≈ 半栏、中 = 正文栏、大 = 出血栏（单独成段图片的默认效果） */
export const IMAGE_DISPLAY_WIDTHS = { small: 340, medium: 680, large: 864 } as const;
export type ImageSizePreset = keyof typeof IMAGE_DISPLAY_WIDTHS;
/** 自定义宽度的范围 */
export const IMAGE_CUSTOM_WIDTH_MIN = 40;
export const IMAGE_CUSTOM_WIDTH_MAX = 2000;

export type ImageDisplaySize = { preset: ImageSizePreset } | { width: number };

const KEY = /images\/\d{4}\/\d{2}\/[\w-]{16}(?:-\d+w)?\.(?:jpg|png|webp|avif|gif)/;
const KEY_GLOBAL = new RegExp(KEY.source, "g");

/**
 * 原图的 key：去掉尺寸后缀（引用小图也算引用了这张图）。
 * 只认 16 位随机串之后的后缀——随机串本身也可能恰好以 "-640w" 这样的字符结尾。
 */
function originalKey(key: string): string {
  return key.replace(/^(images\/\d{4}\/\d{2}\/[\w-]{16})-\d+w(\.\w+)$/, "$1$2");
}

/** 地址里媒体库图片的 key（原图）；不是媒体库的图片返回 null */
export function imageKeyOf(url: string): string | null {
  const match = KEY.exec(url);
  return match ? originalKey(match[0]) : null;
}

/** 正文里引用到的所有媒体库图片 key（去重，原图） */
export function imageKeysIn(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(KEY_GLOBAL)].map(([key]) => originalKey(key)))];
}

/** 原图地址 → 某个尺寸版本的地址 */
export function variantUrl(url: string, width: number): string {
  return url.replace(/(\.\w+)([?#].*)?$/, `-${width}w$1`);
}

/** 读取地址里的显示尺寸，返回去掉片段后的地址；没有或无法识别的片段原样保留 */
export function parseImageSize(src: string): { src: string; size: ImageDisplaySize | null } {
  const hash = src.indexOf("#");
  if (hash === -1) return { src, size: null };
  const fragment = src.slice(hash + 1);
  const bare = src.slice(0, hash);
  if (fragment in IMAGE_DISPLAY_WIDTHS) return { src: bare, size: { preset: fragment as ImageSizePreset } };
  const custom = /^w=(\d{1,4})$/.exec(fragment);
  if (custom) {
    const width = Number(custom[1]);
    if (width >= IMAGE_CUSTOM_WIDTH_MIN && width <= IMAGE_CUSTOM_WIDTH_MAX) return { src: bare, size: { width } };
  }
  return { src, size: null };
}

/** 给地址设置显示尺寸（null 表示默认，去掉片段） */
export function withImageSize(src: string, size: ImageDisplaySize | null): string {
  const bare = parseImageSize(src).src;
  if (!size) return bare;
  return "preset" in size ? `${bare}#${size.preset}` : `${bare}#w=${size.width}`;
}

import { z } from "zod";

/*
 * 生成头图的可选项（图像模型、画质、头图风格）：设置（settings.ts）要用它们校验，所以单独成一个只依赖 zod 的模块，
 * 避免 settings.ts → cover.ts → translation.ts → settings.ts 的循环导入。接口的输入输出在 cover.ts。
 */

// ---------- 图像模型 ----------

/**
 * 可选的图像模型（2026-10 按 OpenAI 文档和 SDK 的类型定义核对：https://developers.openai.com/api/docs/guides/image-generation 、/api/docs/pricing）。
 * 两个 2.5 模型的 token 单价相同（图像输出每百万 token $30），每张图的 token 数随模型、画质、尺寸变化；
 * 实际用量每次记在日志里，也显示在生成结果下面。
 */
export const coverImageModels = [
  {
    id: "gpt-image-2.5-flare",
    name: "GPT Image 2.5 Flare",
    summary: "OpenAI 定位为快速、高质量的日常出图，默认选择",
  },
  {
    id: "gpt-image-2.5-sunburst",
    name: "GPT Image 2.5 Sunburst",
    summary: "OpenAI 定位为编辑精度最高；这里只生成新图，多半用不到",
  },
] as const;

export type CoverImageModel = (typeof coverImageModels)[number];
export type CoverImageModelId = CoverImageModel["id"];

const imageModelIds = coverImageModels.map((model) => model.id) as [CoverImageModelId, ...CoverImageModelId[]];
export const coverImageModelIdSchema = z.enum(imageModelIds);

export function coverImageModelInfo(id: CoverImageModelId): CoverImageModel {
  const model = coverImageModels.find((m) => m.id === id);
  if (!model) throw new Error(`unknown image model ${id}`);
  return model;
}

export const DEFAULT_COVER_IMAGE_MODEL: CoverImageModelId = "gpt-image-2.5-flare";

/**
 * 画质：token 数（也就是价格和耗时）随画质增长。2.5 模型还支持 xhigh / max，头图用不到，不放进来。
 * 旧模型横图的输出 token 约为 low 400 / medium 1568 / high 6208（2.5 的没有公开表格，以实际用量为准）。
 */
export const coverImageQualities = [
  { id: "low", name: "低", summary: "最便宜、最快，适合先试方向" },
  { id: "medium", name: "中", summary: "默认。头图在列表里只显示成缩略图，通常够用" },
  { id: "high", name: "高", summary: "细节更多，token 约是“中”的 4 倍，耗时也更长" },
] as const;
export type CoverImageQuality = (typeof coverImageQualities)[number]["id"];
export const coverImageQualitySchema = z.enum(coverImageQualities.map((q) => q.id) as [CoverImageQuality, ...CoverImageQuality[]]);
export const DEFAULT_COVER_IMAGE_QUALITY: CoverImageQuality = "medium";

/**
 * 出图尺寸：16:9（YouTube 缩略图、分享卡片的比例）。宽高都是 16 的倍数，总像素在 2.5 模型的范围内。
 * 1536 宽：浏览器会生成 640 / 1280 两个版本，og:image 用 1280（≥ 1200 的最小版本）；列表卡片按 4:3 裁掉两边。
 */
export const COVER_IMAGE_WIDTH = 1536;
export const COVER_IMAGE_HEIGHT = 864;

// ---------- 头图风格（设置里可改） ----------

export const COVER_STYLE_MAX_LENGTH = 4000;

/**
 * 默认的头图风格：英文写给图像模型（也给写描述的 Claude 看）。参考 YouTube 缩略图：一个大而清楚的主体、强对比、
 * 构图简单、缩到很小也认得出。
 * 文字：头图三种语言共用（英文、日文页面和它们的分享卡片显示的是同一张图），而且图像模型写中文仍会写错字，
 * 所以默认不放文字，最多 1–3 个各语言都一样的短词（产品名、代码关键字、数字），绝不放中文、日文。
 */
export const DEFAULT_COVER_STYLE = [
  "Cover image for a personal technical blog post, 16:9, as eye-catching as a great YouTube thumbnail.",
  "- One bold focal subject that reads instantly, even as a tiny thumbnail. Large in the frame, simple strong silhouette.",
  "- Keep everything important inside the central three quarters of the width: the image is also cropped to 4:3 for list cards.",
  "- High contrast, saturated but harmonious colors, dramatic lighting, a clean uncluttered background with some depth.",
  "- Graphic rather than photographic: polished 3D render or bold flat illustration. No stock-photo look.",
  "- Text: none by default. Only if it clearly helps, at most one to three short words in huge, bold, sans-serif letters,",
  "  and only language-neutral words such as product names, code keywords or numbers (for example Next.js, v5, 404).",
  "  Never Chinese or Japanese characters, never sentences, captions, small print, watermarks, or real company logos.",
].join("\n");

export const coverStyleSchema = z.string().trim().min(1, "头图风格不能为空").max(COVER_STYLE_MAX_LENGTH);

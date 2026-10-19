import { z } from "zod";
import { coverImageModelIdSchema, coverImageQualitySchema } from "./cover-options.ts";
import { apiErrorCodeSchema } from "./post.ts";
import { translationModelIdSchema } from "./settings.ts";
import { translationUnavailableReasons, translationUsageSchema } from "./translation.ts";

/*
 * 生成头图（后台文章编辑器的"头图"旁边）：两步，都由作者手动触发，结果先给作者看，选中的才进媒体库。
 *   1. 画面描述：Claude 读标题、标签和正文，按"头图风格"写一段给图像模型的英文描述（POST /admin/covers/brief）。
 *      作者可以改，也可以不用 Claude、自己写。
 *   2. 出图：OpenAI GPT Image 按"头图风格 + 画面描述"生成一张 16:9 的图（POST /admin/covers/generate，NDJSON 流）。
 *      浏览器拿到图片后走和手动上传同一条路（缩放、生成尺寸版本、预签名直传、确认），进媒体库、设为头图。
 * 为什么不让 API 直接存进媒体库：作者可能连生成好几张才挑一张，没选中的不该进存储；尺寸版本也只在浏览器里生成（见 CLAUDE.md"媒体库与图片"）。
 */

// ---------- 第一步：画面描述 ----------

/** 画面描述（给图像模型的提示词）的长度上限。和风格拼起来仍远小于 OpenAI 的 32000 字符 */
export const COVER_PROMPT_MAX_LENGTH = 4000;
/** 作者给 Claude 的方向（"用猫比喻缓存"），可选 */
export const COVER_DIRECTION_MAX_LENGTH = 500;
/** 只把正文的前这么多字给 Claude：头图要的是主题，不是细节；20 万字的长文全发过去既贵又没必要 */
export const COVER_SOURCE_MAX_CHARS = 12_000;
/** 和媒体库的图片描述同一个上限（imageUpdateInputSchema） */
export const COVER_ALT_MAX_LENGTH = 500;

/** POST /admin/covers/brief：表单里此刻的内容（新文章还没保存、没有 id 也能用） */
export const coverBriefInputSchema = z.strictObject({
  title: z.string().trim().min(1, "先写标题").max(200),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  // 正文可以为空（只有标题也能写描述）；超出 COVER_SOURCE_MAX_CHARS 的部分由 API 截掉
  contentMd: z.string().max(200_000).default(""),
  direction: z.string().trim().max(COVER_DIRECTION_MAX_LENGTH).optional(),
});
export type CoverBriefInput = z.input<typeof coverBriefInputSchema>;

export const coverBriefResultSchema = z.object({
  /** 画面描述（英文），给作者看、可改，第二步原样发回 */
  prompt: z.string().min(1).max(COVER_PROMPT_MAX_LENGTH),
  /** 图片描述（原文语言），上传后写进媒体库，用作头图的 alt */
  alt: z.string().max(COVER_ALT_MAX_LENGTH),
  model: z.string().min(1),
  usage: translationUsageSchema,
});
export type CoverBriefResult = z.infer<typeof coverBriefResultSchema>;

// ---------- 第二步：出图 ----------

/** POST /admin/covers/generate。模型、画质、风格都用设置里的 */
export const coverImageInputSchema = z.strictObject({
  prompt: z.string().trim().min(1, "先写画面描述").max(COVER_PROMPT_MAX_LENGTH),
});
export type CoverImageInput = z.infer<typeof coverImageInputSchema>;

export const coverImageContentTypes = ["image/webp", "image/png", "image/jpeg"] as const;

export const coverImageUsageSchema = z.object({
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
});
export type CoverImageUsage = z.infer<typeof coverImageUsageSchema>;

/** base64 编码的图片：只校验字符集，不在这里解码（解码交给浏览器） */
const base64Image = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, "不是 base64");

/** 流里没有别的输出时，API 每隔这么久发一个 ping（毫秒）：出图可能要一两分钟，中间的代理不能把连接当成空闲的掐掉 */
export const COVER_HEARTBEAT_MS = 10_000;

/**
 * 出图的流式响应（application/x-ndjson）：若干 ping / partial，最后以 done 或 error 结束。
 * partial 是生成过程中的预览图（OpenAI 的 partial_images），让作者早点看出方向不对、及时停止；不能当成结果用。
 */
export const coverImageStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("partial"), index: z.int().nonnegative(), contentType: z.enum(coverImageContentTypes), image: base64Image }),
  z.object({
    type: z.literal("done"),
    contentType: z.enum(coverImageContentTypes),
    image: base64Image,
    model: z.string().min(1),
    quality: coverImageQualitySchema,
    usage: coverImageUsageSchema,
  }),
  z.object({ type: z.literal("error"), code: apiErrorCodeSchema, message: z.string() }),
]);
export type CoverImageStreamEvent = z.infer<typeof coverImageStreamEventSchema>;
export type CoverImageResult = Extract<CoverImageStreamEvent, { type: "done" }>;

// ---------- 配置 ----------

/**
 * GET /admin/covers/config：两步各自能不能用（原因和翻译一样：没配密钥 / Redis，或 Redis 此刻连不上）、用哪个模型。
 * 两步互不依赖：没有 OPENAI_API_KEY 时仍能让 Claude 写描述（拿去别处出图），没有 ANTHROPIC_API_KEY 时可以自己写描述再出图。
 */
const availability = <T extends z.ZodRawShape>(shape: T) =>
  z.discriminatedUnion("available", [
    z.object({ available: z.literal(true), ...shape }),
    z.object({ available: z.literal(false), ...shape, reason: z.enum(translationUnavailableReasons) }),
  ]);

export const coverConfigSchema = z.object({
  brief: availability({ model: translationModelIdSchema }),
  image: availability({ model: coverImageModelIdSchema, quality: coverImageQualitySchema }),
});
export type CoverConfig = z.infer<typeof coverConfigSchema>;

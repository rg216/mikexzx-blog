import {
  type ApiErrorCode,
  COVER_IMAGE_HEIGHT,
  COVER_IMAGE_WIDTH,
  type CoverImageModelId,
  type CoverImageQuality,
  type CoverImageUsage,
  coverImageContentTypes,
} from "@blog/shared";
import OpenAI from "openai";

/*
 * 生成头图的第二步：OpenAI GPT Image 出图（Image API，POST /v1/images/generations）。
 * 参数按 openai SDK 7.39 的类型定义核对（2026-10）：GPT Image 只返回 base64（没有图片网址），
 * 2.5 模型支持任意 16 倍数的尺寸、low … max 的画质、png / jpeg / webp 输出；stream: true 时
 * 先发 partial_images 张预览（每张多计约 100 个输出 token），最后一个 image_generation.completed 事件带完整的图和用量。
 *
 * 为什么流式：出图可能要一两分钟（文档："Complex prompts may take up to 2 minutes"）。不流式的话这期间一个字节都没有，
 * 浏览器经前端 /api 代理过来，代理等首字节有时限；流式加上我们自己的心跳，连接上一直有数据，作者还能先看到预览。
 *
 * 这个模块只管"怎么调 API"；路由经 CoverImager 接口使用它，测试注入假实现（绝不在测试里发真请求）。
 */

export type CoverImageRequest = {
  /** 作者确认过的画面描述 */
  prompt: string;
  /** 设置里的头图风格，拼在描述前面 */
  style: string;
  model: CoverImageModelId;
  quality: CoverImageQuality;
  /** 交给 OpenAI 做滥用监测的用户标识（哈希过，不含可识别的信息） */
  safetyIdentifier: string;
};

export type CoverImageContentType = (typeof coverImageContentTypes)[number];

/**
 * - start：上游已接受请求（HTTP 层面的错误——凭证无效、内容审核拒绝提示词、限流——在它之前抛出）；
 * - partial：生成中的预览；
 * - done：完成的图片。
 */
export type CoverImageEvent =
  | { type: "start" }
  | { type: "partial"; index: number; image: string; contentType: CoverImageContentType }
  | { type: "done"; image: string; contentType: CoverImageContentType; model: string; quality: CoverImageQuality; usage: CoverImageUsage };

export type CoverImager = {
  /** signal 中止时停止上游请求，迭代以错误结束 */
  generate(request: CoverImageRequest, options: { signal: AbortSignal }): AsyncIterable<CoverImageEvent>;
  /** 状态页用：密钥有效、这个模型对这个账号可用（GET /v1/models/{id}，不花钱） */
  verifyModel(model: CoverImageModelId, options: { signal: AbortSignal }): Promise<void>;
};

/** 预览张数（0–3）。2 张：作者在半途看得出构图和配色，又不至于让响应太大（每张都是一整张 base64 图） */
export const PARTIAL_IMAGES = 2;

/**
 * 输出 WebP，压缩到 90：浏览器上传前会按媒体库的规则重新编码（见 lib/image-prepare.ts），这里只要画质够、传得快。
 * 1536×864 的 WebP 一般几百 KB，base64 之后连同预览也远小于 Vercel 函数的响应体上限（4.5MB）。
 */
const OUTPUT_FORMAT = "webp";
const OUTPUT_COMPRESSION = 90;
const contentTypeOf = { webp: "image/webp", png: "image/png", jpeg: "image/jpeg" } as const satisfies Record<string, CoverImageContentType>;

/** 发给图像模型的完整提示词：风格在前（每次相同），画面描述在后 */
export function coverImagePrompt(style: string, prompt: string): string {
  return `${style.trim()}\n\nThe image to create:\n${prompt.trim()}`;
}

export function buildCoverImageRequest(request: CoverImageRequest): OpenAI.Images.ImageGenerateParamsStreaming {
  return {
    model: request.model,
    prompt: coverImagePrompt(request.style, request.prompt),
    size: `${COVER_IMAGE_WIDTH}x${COVER_IMAGE_HEIGHT}`,
    quality: request.quality,
    output_format: OUTPUT_FORMAT,
    output_compression: OUTPUT_COMPRESSION,
    // 头图要铺满卡片，不要透明背景
    background: "opaque",
    n: 1,
    stream: true,
    partial_images: PARTIAL_IMAGES,
    safety_identifier: request.safetyIdentifier,
  };
}

// ---------- 错误分类（纯函数） ----------

export type ImagerFailure = {
  status: 400 | 429 | 500 | 502;
  code: ApiErrorCode;
  /** 给作者看的说明（不含密钥等内部信息） */
  message: string;
  aborted: boolean;
};

const upstream = (message: string): ImagerFailure => ({ status: 502, code: "internal_error", message, aborted: false });
const UNAVAILABLE = "OpenAI 图像服务暂时不可用，请稍后再试";
const BILLING = "OpenAI 账户的额度或账单有问题（详见服务器日志）";

/**
 * 把 SDK 的错误分类成我们的错误响应。用 SDK 的类型化错误类判断；APIUserAbortError、APIConnectionError 是 APIError 的子类，先判断。
 * 流开始之后上游发来的错误事件，SDK 抛出没有 status 的 APIError，原因在 code / type 里。
 */
export function classifyImagerError(error: unknown): ImagerFailure {
  if (error instanceof OpenAI.APIUserAbortError) return { status: 500, code: "internal_error", message: "生成已取消", aborted: true };
  if (error instanceof OpenAI.APIConnectionError) return upstream("连接 OpenAI 失败，请稍后再试");
  if (error instanceof OpenAI.APIError) {
    // 内容审核拦下了提示词或生成的图：作者改一下描述就能重试，是"请求的内容"问题，不是故障（文档：不要原样自动重试）
    if (error.code === "moderation_blocked") {
      return { status: 400, code: "validation_error", message: "被 OpenAI 的内容审核拦下了，改一下画面描述再试", aborted: false };
    }
    // 429 也可能是额度用完（insufficient_quota），那不是"稍后再试"能解决的
    if (error.code === "insufficient_quota" || error.code === "billing_hard_limit_reached") return upstream(BILLING);
    if (error instanceof OpenAI.AuthenticationError) return upstream("OpenAI 的密钥无效（详见服务器日志）");
    // GPT Image 可能要求先完成 OpenAI 的组织验证（文档："you may need to complete the API Organization Verification"）
    if (error instanceof OpenAI.PermissionDeniedError) return upstream("OpenAI 拒绝了请求：密钥没有权限，或组织还没有完成验证（详见服务器日志）");
    if (error instanceof OpenAI.RateLimitError) return { status: 429, code: "rate_limited", message: "OpenAI 繁忙（上游限流），请稍后再试", aborted: false };
    if (typeof error.status === "number" && error.status >= 500) return upstream(UNAVAILABLE);
    if (typeof error.status === "number") return upstream("OpenAI 拒绝了请求（详见服务器日志）");
    return upstream(UNAVAILABLE);
  }
  return { status: 500, code: "internal_error", message: "服务器内部错误", aborted: false };
}

// ---------- 真实现 ----------

type Options = {
  /** 测试用：替换 SDK 发请求用的 fetch（返回伪造的 SSE 响应） */
  fetch?: typeof fetch;
  maxRetries?: number;
};

export function createOpenAiCoverImager(apiKey: string, options: Options = {}): CoverImager {
  const client = new OpenAI({
    apiKey,
    // 一次出图就要一两分钟：SDK 默认的 2 次重试可能让一个请求超过函数的时长上限，最多重试 1 次
    maxRetries: options.maxRetries ?? 1,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    async *generate(request, { signal }) {
      // await 到响应头为止：HTTP 层面的错误在这里抛出，还没开始我们自己的流
      const stream = await client.images.generate(buildCoverImageRequest(request), { signal });
      yield { type: "start" };
      try {
        for await (const event of stream) {
          const contentType = contentTypeOf[event.output_format];
          if (event.type === "image_generation.partial_image") {
            yield { type: "partial", index: event.partial_image_index, image: event.b64_json, contentType };
          } else if (event.type === "image_generation.completed") {
            const usage = { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens };
            yield { type: "done", image: event.b64_json, contentType, model: request.model, quality: request.quality, usage };
            return;
          }
        }
      } finally {
        // 提前结束（中止、break）时停止上游请求
        stream.controller.abort();
      }
    },

    async verifyModel(model, { signal }) {
      await client.models.retrieve(model, { signal });
    },
  };
}

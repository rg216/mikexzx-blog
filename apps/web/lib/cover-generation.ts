import {
  type CoverImageModelId,
  coverImageModelInfo,
  type CoverImageQuality,
  coverImageQualities,
  type CoverImageUsage,
  type TranslationUnavailableReason,
} from "@blog/shared";

/*
 * 生成头图的纯逻辑和文案（不依赖 React，单元测试直接跑）。流程见 components/admin/CoverGenerator.tsx。
 */

/** base64 → Blob（上传进媒体库用）。不用 fetch(data:…)：那要求 CSP 的 connect-src 允许 data:，以后加 CSP 时容易漏 */
export function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** 在 <img> 里显示（只用在后台的预览上） */
export function dataUrl(base64: string, type: string): string {
  return `data:${type};base64,${base64}`;
}

const extensions: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

/** 媒体库里的文件名：cover-<slug>-<第几张>.webp。slug 还没填时用 untitled */
export function coverFileName(slug: string, n: number, contentType: string): string {
  const base = slug.trim().replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "untitled";
  return `cover-${base}-${n}.${extensions[contentType] ?? "img"}`;
}

export function imageModelLabel(model: CoverImageModelId): string {
  return coverImageModelInfo(model).name;
}

export function qualityLabel(quality: CoverImageQuality): string {
  return coverImageQualities.find((q) => q.id === quality)?.name ?? quality;
}

const tokens = new Intl.NumberFormat("zh-CN");

export function formatImageUsage(usage: CoverImageUsage): string {
  return `输入 ${tokens.format(usage.inputTokens)} · 输出 ${tokens.format(usage.outputTokens)} token`;
}

/** 两步不能用时的说明。Record：shared 里加了新原因，这里会编译报错 */
export const briefUnavailableNotes: Record<TranslationUnavailableReason, string> = {
  not_configured: "服务器没有启用 Claude（需要 ANTHROPIC_API_KEY 和 REDIS_URL），可以自己写画面描述",
  rate_limiter_unavailable: "限流服务（Redis）暂时连不上：为了控制费用，先停用，请稍后重试",
};

export const imageUnavailableNotes: Record<TranslationUnavailableReason, string> = {
  not_configured: "服务器没有启用出图（需要 OPENAI_API_KEY 和 REDIS_URL）",
  rate_limiter_unavailable: "限流服务（Redis）暂时连不上：为了控制费用，出图先停用，请稍后重试",
};

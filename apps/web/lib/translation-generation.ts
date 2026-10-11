import {
  checkTranslationStructure,
  combineModelNames,
  fitTranslatedSegment,
  type Locale,
  splitMarkdownForTranslation,
  type StructureCheckResult,
  type TranslationUnavailableReason,
  type TranslationUsage,
} from "@blog/shared";
import { type AdminApi, AdminApiError } from "./admin-api";
import { site } from "./site";

/*
 * 大模型翻译（v5.5）在编辑器里的流程：先请求标题，再逐段请求正文，拼成整篇译文，最后做结构校验。
 * 不依赖 React：编辑器只负责显示进度和结果，流程本身在这里，用假的 api 就能测试。
 *
 * 为什么逐段、由浏览器发起：正文最长 20 万字，一次生成可能超过模型的输出上限，也远超 Vercel 函数的时限；
 * 每段一次请求、一次函数调用，都能在时限内完成（分段规则见 @blog/shared 的 splitMarkdownForTranslation，
 * 前后端用同一个函数，段号对得上）。
 * 为什么顺序请求而不是并发：第一个请求（标题）把"整篇原文"写进提示缓存，后面每段都命中缓存；
 * 并发的话几个请求同时缓存未命中，都按全价计费。顺序还让"停止"和失败处理简单：任何时刻最多一个请求在途。
 */

export const zeroUsage: TranslationUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

export function addUsage(a: TranslationUsage, b: TranslationUsage): TranslationUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
}

const tokenFormatter = new Intl.NumberFormat(site.locale);

/**
 * 用量显示："输入 1,234 · 输出 567 · 缓存命中 1,000 · 缓存写入 200"。
 * 输入 token 只算没走缓存的部分（API 的 input_tokens 不含缓存读写），所以三项相加才是总输入。
 */
export function formatUsage(usage: TranslationUsage): string {
  const f = (n: number) => tokenFormatter.format(n);
  return `输入 ${f(usage.inputTokens)} · 输出 ${f(usage.outputTokens)} · 缓存命中 ${f(usage.cacheReadInputTokens)} · 缓存写入 ${f(usage.cacheCreationInputTokens)}`;
}

/** 服务器说现在不能生成译文时（GET /admin/translation/config 的 reason），给作者的说明。Record：shared 里加了新原因，这里会编译报错 */
export const unavailableReasonNotes: Record<TranslationUnavailableReason, string> = {
  not_configured: "服务器未启用翻译功能（需要设置 ANTHROPIC_API_KEY 和 REDIS_URL），暂时不能生成译文",
  rate_limiter_unavailable: "限流服务（Redis）暂时连不上：为了控制调用费用，生成译文先停用，请稍后重试",
};

// ---------- 拼接 ----------

// 实时显示时去掉当前段开头的空行（只认 Markdown 意义上的空白；全角空格是内容）
const LEADING_BLANK_LINES = /^(?:[ \t]*\r?\n)+/;

/**
 * 已完成的各段译文按原文的段落位置拼起来（translated 可以比 sourceSegments 短：只拼已完成的部分）。
 * 每段的首尾空行对齐原文那一段（fitTranslatedSegment，和 API 共用；API 已经对齐过，再对齐一次结果不变）。
 */
export function joinTranslatedSegments(sourceSegments: readonly string[], translated: readonly string[]): string {
  return translated.map((text, i) => fitTranslatedSegment(sourceSegments[i] ?? "", text)).join("");
}

/**
 * 实际服务的模型（服务端回退时可能不是请求的那个，见 API 的 translator.ts）。各次请求可能不同：
 * 去重后按首次出现的顺序列出，如实记录"这篇译文是哪些模型生成的"。
 * 用 @blog/shared 的 combineModelNames：结果总在保存接口允许的长度内（太多时末尾写 "…"），保存不会因此失败。
 */
export function combineModels(models: readonly string[]): string {
  return combineModelNames(models);
}

// ---------- 成败判断 ----------

/** 一段正常结束但不能用（拒答、截断、空译文） */
export class SegmentRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SegmentRejectedError";
  }
}

/**
 * done 事件的 stopReason → 失败原因；正常结束（end_turn）返回 null。
 * 内容准确优先于翻译完整：拒答、截断、未知原因都算失败，这一段不能用。
 */
export function stopReasonFailure(stopReason: string): string | null {
  if (stopReason === "end_turn") return null;
  if (stopReason === "refusal") return "模型拒绝翻译这部分内容";
  if (stopReason === "max_tokens") return "译文超出长度上限，被截断了";
  return `生成意外结束（${stopReason}）`;
}

export type FailureAction = "retry" | "reload" | "none";

export type FailureDescription = { title: string; message: string; action: FailureAction };

/** 生成失败时 Banner 显示什么、给什么操作。where 是"标题"或"第 3/7 段" */
export function describeGenerationFailure(error: unknown, where: string): FailureDescription {
  const title = `生成失败（${where}）`;
  // 已完成的段只在内存里（编辑器保持生成前的内容），作者看不到、也复制不了，所以不能建议"手动翻译这部分"
  if (error instanceof SegmentRejectedError) return { title, message: `${error.message}。可以重试；仍然失败的话需要手动翻译。`, action: "retry" };
  if (!(error instanceof AdminApiError)) return { title, message: "出现了意外错误，请稍后重试", action: "retry" };
  switch (error.code) {
    case "conflict":
      // 原文在本页打开之后改过：段落对不上了，重试也没用
      return { title: "原文已更新", message: "原文在本页打开之后被修改过，请载入最新原文后重新生成。", action: "reload" };
    case "unauthorized":
      return { title: "登录已过期", message: "正在跳转到登录页…", action: "none" };
    case "not_found":
      return { title: "这篇文章已不存在", message: "它可能已在其他地方被删除。", action: "none" };
    case "rate_limited":
      return { title, message: `${error.message}。已完成的部分会保留，稍后点"重试"从这里继续。`, action: "retry" };
    default:
      return { title, message: error.message, action: "retry" };
  }
}

// ---------- 流程 ----------

type Piece = { text: string; model: string; usage: TranslationUsage };

/**
 * 已完成的部分。失败后"重试"从失败的那一步继续，不再为已经翻译好的部分付费；
 * 只对同一版原文有效（sourceHash 相同），原文变了就从头开始。
 */
export type GenerationPartial = { sourceHash: string; title: Piece | null; segments: Piece[] };

export type GenerationStep = { part: "title" } | { part: "body"; index: number; total: number };

export type GenerationProgress = GenerationStep & {
  /** 已生成的标题（标题还没好时为 null） */
  title: string | null;
  /** 正文框里实时显示的内容：已完成的段 + 当前段已收到的部分 */
  liveText: string;
  /** 已完成的段拼成的正文（预览只渲染完整的段：半段可能有没闭合的代码块，渲染出来一跳一跳的） */
  completedText: string;
  /** 当前段还没有收到译文、API 发来了心跳：模型在思考（第一段译文之前可能要几十秒） */
  thinking?: true;
};

export type GenerationSource = {
  postId: number;
  locale: Locale;
  title: string;
  contentMd: string;
  sourceHash: string;
};

export type GenerationResult = {
  title: string;
  contentMd: string;
  model: string;
  usage: TranslationUsage;
  check: StructureCheckResult;
};

/** 生成没有完成：被中止（作者点了停止 / 离开页面），或者某一步失败 */
export class GenerationError extends Error {
  readonly reason: "aborted" | "failed";
  readonly step: GenerationStep;
  /** 失败前已完成的部分，传给下一次 runTranslationGeneration 的 resume 就能从失败处继续 */
  readonly partial: GenerationPartial;

  constructor(reason: "aborted" | "failed", step: GenerationStep, partial: GenerationPartial, options?: ErrorOptions) {
    super(reason === "aborted" ? "已停止生成" : "生成失败", options);
    this.name = "GenerationError";
    this.reason = reason;
    this.step = step;
    this.partial = partial;
  }
}

export function stepLabel(step: GenerationStep): string {
  return step.part === "title" ? "标题" : `第 ${step.index + 1}/${step.total} 段`;
}

export type GenerationApi = Pick<AdminApi, "generateTranslationTitle" | "streamTranslationSegment">;

type RunOptions = {
  signal: AbortSignal;
  onProgress?: (progress: GenerationProgress) => void;
  /** 上次失败时已完成的部分（原文指纹不同就忽略） */
  resume?: GenerationPartial | null;
};

/**
 * 开始生成之后的这段时间里，"停止"不生效（毫秒）。生成和停止是同一个位置的同一个按钮：
 * 双击"生成译文"、或确认对话框关闭后焦点回到按钮时多按一次回车，第二下就落在刚变出来的"停止"上——
 * 刚开始的请求被中止，可能已经计费。离开页面时的中止不受此限（见 useTranslationGeneration 的 abort）。
 */
export const STOP_GRACE_MS = 500;

/** 这次"停止"是否落在开始后的保护期内（应忽略） */
export function isWithinStopGrace(startedAt: number, now: number): boolean {
  return now - startedAt < STOP_GRACE_MS;
}

/** 标题一行：去掉换行（标题框本来也不允许换行）和首尾空白 */
function cleanTitle(title: string): string {
  return title.replace(/[\r\n]+/g, " ").trim();
}

export async function runTranslationGeneration(api: GenerationApi, source: GenerationSource, { signal, onProgress, resume }: RunOptions): Promise<GenerationResult> {
  const sourceSegments = splitMarkdownForTranslation(source.contentMd);
  const total = sourceSegments.length;
  // 续做时复制一份再往里加：上次失败时交出去的 partial 不会被这次改动
  const partial: GenerationPartial =
    resume?.sourceHash === source.sourceHash
      ? { sourceHash: source.sourceHash, title: resume.title, segments: resume.segments.slice(0, total) }
      : { sourceHash: source.sourceHash, title: null, segments: [] };

  let step: GenerationStep = { part: "title" };
  const completedText = () => joinTranslatedSegments(sourceSegments, partial.segments.map((s) => s.text));
  const checkAborted = () => {
    if (signal.aborted) throw new GenerationError("aborted", step, partial, { cause: signal.reason });
  };

  try {
    checkAborted();
    if (!partial.title) {
      onProgress?.({ ...step, title: null, liveText: completedText(), completedText: completedText() });
      const result = await api.generateTranslationTitle(source.postId, source.locale, source.sourceHash, signal);
      checkAborted();
      const title = cleanTitle(result.title);
      if (title === "") throw new SegmentRejectedError("模型返回了空标题");
      partial.title = { text: title, model: result.model, usage: result.usage };
    }

    for (let index = partial.segments.length; index < total; index++) {
      step = { part: "body", index, total };
      const before = completedText();
      // 当前段已收到的部分。开头的空行先去掉，免得正文框里出现一段忽有忽无的空白
      let received = "";
      const title = partial.title.text;
      onProgress?.({ ...step, title, liveText: before, completedText: before });
      const done = await api.streamTranslationSegment(source.postId, source.locale, {
        index,
        sourceHash: source.sourceHash,
        signal,
        onPing: () => {
          // 已经开始输出之后的心跳（输出中途停顿）不改变显示
          if (received === "") onProgress?.({ ...step, title, liveText: before, completedText: before, thinking: true });
        },
        onDelta: (text) => {
          received += text;
          onProgress?.({ ...step, title, liveText: before + received.replace(LEADING_BLANK_LINES, ""), completedText: before });
        },
      });
      checkAborted();
      const failure = stopReasonFailure(done.stopReason);
      if (failure) throw new SegmentRejectedError(failure);
      // 原文这一段有内容（分段只产生非空段），译文却是空的：一定是出了问题，不能悄悄丢掉一段
      if (done.text.trim() === "") throw new SegmentRejectedError("模型返回了空译文");
      partial.segments.push({ text: done.text, model: done.model, usage: done.usage });
    }
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    // 中止时 fetch 抛 AbortError；也可能中止和失败同时发生——作者已经点了停止，按中止处理
    if (signal.aborted) throw new GenerationError("aborted", step, partial, { cause: error });
    throw new GenerationError("failed", step, partial, { cause: error });
  }

  const title = partial.title;
  const contentMd = completedText();
  const pieces = [title, ...partial.segments];
  return {
    title: title.text,
    contentMd,
    model: combineModels(pieces.map((p) => p.model)),
    usage: pieces.reduce((sum, p) => addUsage(sum, p.usage), zeroUsage),
    check: checkTranslationStructure(source.contentMd, contentMd),
  };
}

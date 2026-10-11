import Anthropic from "@anthropic-ai/sdk";
import { type ApiErrorCode, type Locale, localeInfo, type TranslationUsage } from "@blog/shared";

/*
 * 大模型翻译（v5.5）：调用 Claude API 把文章译成其他语言。只由作者在后台点击触发，结果先进编辑器，保存后才对读者可见。
 *
 * 为什么分段：正文最长 20 万字，一次输出可能超过模型 128K token 的输出上限，也远超 Vercel 函数的最长执行时间。
 * 所以原文按 Markdown 块边界切成若干段（@blog/shared 的 splitMarkdownForTranslation，前后端算出相同的段），
 * 浏览器逐段请求，每段一次 API 调用、一次函数调用，都能在时限内完成。
 *
 * 提示缓存：每个请求的前缀都是"系统提示 + 整篇原文"（逐字节相同，cache_control 打在整篇原文那个块上），
 * 后面才是"这次翻译标题 / 第 i 段"的指令。同一篇文章的标题和各段请求共享缓存前缀：成本低（缓存读取约 0.1 倍价格），
 * 模型每次都看得到全文，术语前后一致。前缀不足 512 token（短文）时不缓存，属正常现象。
 *
 * 这个模块只管"怎么调 API"；路由经 Translator 接口使用它，测试注入假实现（绝不在测试里发真请求）。
 */

/** 翻译用的模型（作者指定 Claude Sonnet 5.5）。服务端回退时实际服务的模型见各结果的 model */
export const TRANSLATION_MODEL = "claude-sonnet-5-5";

/**
 * 服务端回退（beta）：Sonnet 5.5 的安全分类器拒答时（cyber、frontier_llm 类别），API 在同一次调用里换模型重跑。
 * "default" 形式由 Anthropic 按拒答类别选择回退模型，不必自己维护模型名；它对应的 beta 头必须是这一个
 * （数组形式用的是 -2026-06-01，混用会 400）。流式时已输出的部分不作废，回退模型接着往下写。
 */
export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * 每段的输出上限：思考也计入 max_tokens。一段原文约 6000 字，译文远小于这个数，留足思考的余量；
 * 流式请求才能设这么大（非流式请求预计超过 10 分钟时 SDK 会拒绝）。
 */
export const SEGMENT_MAX_TOKENS = 64_000;

/**
 * 标题请求的输出上限。标题本身只有几十个 token，但自适应思考也计入 max_tokens，
 * 给 1000 左右的话思考稍长就会被截断（stop_reason = max_tokens），所以放宽到 4000。
 */
export const TITLE_MAX_TOKENS = 4_000;

/**
 * 思考深度：翻译准确优先，用 high（Sonnet 5.5 的默认值，这里显式写出）。
 * 标题和正文必须用同一个值：改变 effort 会让提示缓存失效。
 */
const EFFORT = "high";

// ---------- 接口 ----------

/** 一次翻译任务：原文（标题 + 正文）、原文语言和目标语言 */
export type TranslationJob = {
  sourceLocale: Locale;
  targetLocale: Locale;
  title: string;
  contentMd: string;
};

/** 正文的一段：splitMarkdownForTranslation(原文) 的第 index 段（共 total 段） */
export type TranslationSegment = { index: number; total: number; text: string };

/** 一次调用的结束状态 */
export type TranslationStop = {
  /** API 的 stop_reason：只有 "end_turn" 算成功；"refusal" 拒答、"max_tokens" 截断等都按失败处理 */
  stopReason: string;
  /** 拒答的类别（stop_details.category），只用于日志和提示；其他情况为 null */
  refusalCategory: string | null;
  /** 实际服务的模型（服务端回退时不是请求的那个） */
  model: string;
  /** 所有尝试的用量之和（见 usageFrom） */
  usage: TranslationUsage;
  /** 是否发生了服务端回退（只记日志） */
  fallback: boolean;
};

export type TitleOutcome = TranslationStop & { text: string };

/**
 * 正文段的事件：
 * - start：上游已接受请求（HTTP 层面的错误——凭证无效、限流——在它之前抛出），路由据此决定用 JSON 错误还是流里的 error 事件；
 * - delta：一小段译文；
 * - done：结束，text 是这一段的完整输出。
 */
export type SegmentEvent =
  | { type: "start" }
  | { type: "delta"; text: string }
  | ({ type: "done"; text: string } & TranslationStop);

export type Translator = {
  /** 请求的模型，后台显示用 */
  readonly model: string;
  translateTitle(job: TranslationJob, options: { signal: AbortSignal }): Promise<TitleOutcome>;
  /** signal 中止时停止上游请求（不再计费），迭代以错误结束 */
  streamSegment(job: TranslationJob, segment: TranslationSegment, options: { signal: AbortSignal }): AsyncIterable<SegmentEvent>;
};

// ---------- 提示词与请求参数（纯函数） ----------

// 语言名用英文写进提示词（"Chinese (China)"、"Japanese"…），由 BCP 47 标签算出，不写死具体语言
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
export const languageName = (locale: Locale): string => languageNames.of(localeInfo[locale].tag) ?? localeInfo[locale].tag;

/** 每种目标语言的文风要求。Record<Locale, …>：加一种语言时 TS 会要求补上 */
export const translationStyles: Record<Locale, string> = {
  zh: "Write natural, fluent Simplified Chinese in the register of a Chinese technical blog, with full-width punctuation.",
  en: "Write natural, concise technical prose, as in a well-edited English engineering blog.",
  ja: "Use the です・ます style and the natural tone of a Japanese technical blog.",
};

/**
 * 系统提示：只由语言对决定，不含日期、文章 id 等任何每次请求都变的东西——前缀逐字节相同，缓存才命中。
 */
export function translationSystemPrompt(sourceLocale: Locale, targetLocale: Locale): string {
  return [
    `You are a senior technical translator. You translate posts from a personal technical blog, written in ${languageName(sourceLocale)}, into ${languageName(targetLocale)}.`,
    "",
    "Rules:",
    "- Preserve the Markdown structure exactly: headings and their levels, lists, tables, block quotes, emphasis, and the blank lines between blocks.",
    "- Copy these verbatim, never translating or altering them: fenced and indented code blocks, inline code, URLs and link destinations, image addresses including any #fragment (such as #small or #w=320), raw HTML, footnote labels such as [^1], and reference-link labels.",
    "- Copy every URL exactly, character for character. Punctuation that belongs to the sentence, such as a full stop or a closing quote right after a URL, is not part of the URL.",
    "- When a bare URL (one not written as [text](url) or <url>) is immediately followed by punctuation or any other non-space text in your translation, wrap it in <...> or put a space after it, so that the link ends exactly where the URL ends. For example, write 「<https://example.com/docs>」を参照 or https://example.com/docs をご覧ください, not 「https://example.com/docs」を参照.",
    "- Translate the human-readable text: paragraphs, headings, list items, table cells, image alt text, link text and link titles, and footnote text.",
    "- Keep proper nouns, product names, library names and commands in their original form.",
    "- Translate faithfully: do not add, omit, summarize or explain anything, and do not add translator's notes.",
    "- Output only the translation, with no preamble, no commentary, and no code fence or tags around it.",
    "",
    `Style: ${translationStyles[targetLocale]}`,
  ].join("\n");
}

/** 整篇原文：标题和各段请求的第一个 content block，逐字节相同（缓存前缀） */
export function sourceDocument(job: TranslationJob): string {
  return [
    "The complete source article is below, for context. You will be asked to translate one part of it at a time.",
    "",
    "<source_title>",
    job.title,
    "</source_title>",
    "",
    "<source_body>",
    job.contentMd,
    "</source_body>",
  ].join("\n");
}

// 标题用 messages.create，正文用 messages.stream（它自己加上 stream: true），参数是同一种
type MessageRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

function baseRequest(job: TranslationJob, task: string, maxTokens: number) {
  return {
    model: TRANSLATION_MODEL,
    max_tokens: maxTokens,
    betas: [SERVER_SIDE_FALLBACK_BETA],
    fallbacks: "default",
    // Sonnet 5.5 的思考只能是自适应（disabled、budget_tokens 都会 400）；不设 temperature 等采样参数（非默认值会 400）
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT },
    system: translationSystemPrompt(job.sourceLocale, job.targetLocale),
    messages: [
      {
        role: "user",
        content: [
          // 缓存断点打在整篇原文上：系统提示 + 原文是共享前缀，后面的指令每次不同
          { type: "text", text: sourceDocument(job), cache_control: { type: "ephemeral" } },
          { type: "text", text: task },
        ],
      },
    ],
  } satisfies MessageRequest;
}

export function buildTitleRequest(job: TranslationJob): MessageRequest {
  const task = `Translate the article title (inside <source_title>) into ${languageName(job.targetLocale)}. Output only the translated title, on a single line.`;
  return baseRequest(job, task, TITLE_MAX_TOKENS);
}

export function buildSegmentRequest(job: TranslationJob, segment: TranslationSegment): MessageRequest {
  const task = [
    `Translate part ${segment.index + 1} of ${segment.total} of the article body into ${languageName(job.targetLocale)}.`,
    "The part is reproduced exactly below, between the <part> tags. Output only its translation: nothing before or after it, no surrounding tags, and no other part of the article.",
    "",
    "<part>",
    segment.text,
    "</part>",
  ].join("\n");
  return baseRequest(job, task, SEGMENT_MAX_TOKENS);
}

// ---------- 结果整理（纯函数） ----------

/** 计入账单的那几种尝试（usage.iterations 里的条目类型）：被拒答的尝试是 message，回退模型那次是 fallback_message */
const BILLED_ATTEMPTS: ReadonlySet<string> = new Set(["message", "fallback_message"]);

/**
 * 一次调用的 token 用量。SDK 的缓存字段可能是 null（没有用到缓存），记为 0。
 *
 * 服务端回退时，顶层的 usage 只是"最后交出结果的那次尝试"的用量；Sonnet 5.5 在流中途拒答之前已经输出的部分
 * 照常计费，却只出现在 usage.iterations 里（每次尝试一条，是计费的依据）。所以有 iterations 时按它逐项相加，
 * 日志和编辑器里显示的用量才等于实际计费。compaction 之类的条目不计入顶层用量，这里也不加（翻译用不到它们）。
 */
export function usageFrom(usage: Anthropic.Beta.Messages.BetaUsage): TranslationUsage {
  const attempts = (usage.iterations ?? []).filter((entry) => BILLED_ATTEMPTS.has(entry.type));
  if (attempts.length === 0) {
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    };
  }
  return attempts.reduce<TranslationUsage>(
    (sum, entry) => ({
      inputTokens: sum.inputTokens + entry.input_tokens,
      outputTokens: sum.outputTokens + entry.output_tokens,
      cacheReadInputTokens: sum.cacheReadInputTokens + (entry.cache_read_input_tokens ?? 0),
      cacheCreationInputTokens: sum.cacheCreationInputTokens + (entry.cache_creation_input_tokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  );
}

/** 这次调用是否由回退模型交出结果（usage.iterations 里有 fallback_message）：只记日志，便于对账 */
export function servedByFallback(usage: Anthropic.Beta.Messages.BetaUsage): boolean {
  return (usage.iterations ?? []).some((entry) => entry.type === "fallback_message");
}

/**
 * 消息里所有 text 块拼起来。按块的 type 取，不按位置：开头可能是（内容为空的）thinking 块；
 * 服务端回退时中间还有 fallback 块，回退模型接着已输出的文字往下写，所以各 text 块直接相连就是完整译文。
 */
export function textOf(message: Anthropic.Beta.Messages.BetaMessage): string {
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function stopOf(message: Anthropic.Beta.Messages.BetaMessage): TranslationStop {
  return {
    // 非流式和流式结束后 stop_reason 都不会是 null；万一是，当作未知原因（不算成功）
    stopReason: message.stop_reason ?? "unknown",
    refusalCategory: message.stop_reason === "refusal" ? (message.stop_details?.category ?? null) : null,
    model: message.model,
    usage: usageFrom(message.usage),
    fallback: servedByFallback(message.usage),
  };
}

// 首尾成对的引号（模型偶尔会给标题加引号）
const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
] as const;

const quotePairOf = (text: string) => QUOTE_PAIRS.find(([open, close]) => text.length >= 2 && text.startsWith(open) && text.endsWith(close));

/**
 * 整理模型输出的标题：多行合成一行、去掉首尾空白、去掉 Markdown 标题符号和首尾成对的引号。
 * 原文标题本身就带这些时保留（那是标题的一部分，不是模型加的）。
 */
export function cleanTranslatedTitle(raw: string, sourceTitle: string): string {
  let title = raw.replace(/\s*\n\s*/g, " ").trim();
  if (!/^#{1,6}\s/.test(sourceTitle.trim())) title = title.replace(/^#{1,6}\s+/, "");
  const pair = quotePairOf(title);
  if (pair && !quotePairOf(sourceTitle.trim())) title = title.slice(pair[0].length, -pair[1].length).trim();
  return title;
}

/** 失败的结束状态给作者看的说明 */
export function stopReasonMessage(stopReason: string, refusalCategory: string | null): string {
  switch (stopReason) {
    case "refusal":
      return `模型拒绝翻译这部分内容${refusalCategory ? `（类别：${refusalCategory}）` : ""}`;
    case "max_tokens":
      return "译文超出了输出长度上限，被截断";
    default:
      return `模型没有正常结束（${stopReason}）`;
  }
}

// ---------- 错误分类（纯函数） ----------

export type TranslatorFailure = {
  status: 429 | 500 | 502;
  code: ApiErrorCode;
  /** 给作者看的说明（不含密钥等任何内部信息） */
  message: string;
  /** 浏览器断开导致的中止：不必回复，也不算错误 */
  aborted: boolean;
};

const TEMPORARILY_UNAVAILABLE = "翻译服务暂时不可用，请稍后再试";
const CREDENTIALS_PROBLEM = "翻译服务的凭证无效或没有权限（详见服务器日志）";
const BILLING_PROBLEM = "翻译服务的账户余额或账单有问题（详见服务器日志）";
const REQUEST_REJECTED = "翻译服务拒绝了请求（详见服务器日志）";
const upstreamRateLimited: TranslatorFailure = { status: 429, code: "rate_limited", message: "翻译服务繁忙（上游限流），请稍后再试", aborted: false };

/**
 * 把 SDK 的错误分类成我们的错误响应。用 SDK 的类型化错误类判断，不做字符串匹配；
 * 注意顺序：APIUserAbortError、APIConnectionError 都是 APIError 的子类，要先判断。
 * SDK 已对 408 / 409 / 429 / 5xx 和连接错误自动重试 2 次，到这里的是重试之后仍失败的。
 */
export function classifyTranslatorError(error: unknown): TranslatorFailure {
  const upstream = (message: string): TranslatorFailure => ({ status: 502, code: "internal_error", message, aborted: false });
  if (error instanceof Anthropic.APIUserAbortError) return { status: 500, code: "internal_error", message: "生成已取消", aborted: true };
  // 凭证无效 / 无权限：是服务器的配置问题，不是作者的请求有问题（返回 502，不把上游的说明透出去）
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return upstream(CREDENTIALS_PROBLEM);
  }
  if (error instanceof Anthropic.RateLimitError) return upstreamRateLimited;
  if (error instanceof Anthropic.APIConnectionError) return upstream("连接翻译服务失败，请稍后再试");
  if (error instanceof Anthropic.APIError) {
    /*
     * 流开始之后（HTTP 200 已经发出）上游在 SSE 里发来的 error 事件：SDK 抛出的 APIError 没有 status，
     * 原因只在 error.type 里（overloaded_error、api_error…）。流开始后 SDK 不会重试，这类错误一定会走到这里。
     */
    switch (error.type) {
      case "overloaded_error":
      case "api_error":
      case "timeout_error":
        return upstream(TEMPORARILY_UNAVAILABLE);
      case "rate_limit_error":
        return upstreamRateLimited;
      case "billing_error":
        return upstream(BILLING_PROBLEM);
      case "authentication_error":
      case "permission_error":
        return upstream(CREDENTIALS_PROBLEM);
      case "invalid_request_error":
      case "not_found_error":
        return upstream(REQUEST_REJECTED);
    }
    if (error.status === 402) return upstream(BILLING_PROBLEM);
    // 500、529（过载）等
    if (typeof error.status === "number" && error.status >= 500) return upstream(TEMPORARILY_UNAVAILABLE);
    // 400 / 404 / 413 等：请求本身被拒（参数、模型不可用…），是代码或配置的问题
    if (typeof error.status === "number") return upstream(REQUEST_REJECTED);
    // 没有状态码、类型也不认识：多半是流中途出的上游故障，按暂时不可用处理（作者重试即可）
    return upstream(TEMPORARILY_UNAVAILABLE);
  }
  return { status: 500, code: "internal_error", message: "服务器内部错误", aborted: false };
}

// ---------- 真实现 ----------

type AnthropicTranslatorOptions = {
  /** 测试用：替换 SDK 发请求用的 fetch（测试里返回伪造的响应，绝不连真 API） */
  fetch?: typeof fetch;
  /** 测试用：关掉自动重试。默认沿用 SDK 的 2 次 */
  maxRetries?: number;
};

export function createAnthropicTranslator(apiKey: string, options: AnthropicTranslatorOptions = {}): Translator {
  const client = new Anthropic({
    apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });

  return {
    model: TRANSLATION_MODEL,

    async translateTitle(job, { signal }) {
      const message = await client.beta.messages.create(buildTitleRequest(job), { signal });
      return { text: textOf(message), ...stopOf(message) };
    },

    async *streamSegment(job, segment, { signal }) {
      const stream = client.beta.messages.stream(buildSegmentRequest(job, segment), { signal });
      // 提前结束迭代（break / return）时 SDK 的迭代器会中止请求；这里再保险一次
      try {
        for await (const event of stream) {
          if (event.type === "message_start") yield { type: "start" };
          else if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield { type: "delta", text: event.delta.text };
        }
        const message = await stream.finalMessage();
        yield { type: "done", text: textOf(message), ...stopOf(message) };
      } finally {
        if (!stream.ended) stream.abort();
      }
    },
  };
}

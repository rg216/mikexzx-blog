import Anthropic from "@anthropic-ai/sdk";
import { COVER_ALT_MAX_LENGTH, COVER_PROMPT_MAX_LENGTH, COVER_SOURCE_MAX_CHARS, type Locale, type TranslationModelId } from "@blog/shared";
import { z } from "zod";
import { languageName, stopOf, textOf, type TranslationStop } from "./translator.ts";

/*
 * 生成头图的第一步：Claude 读文章，写一段给图像模型的画面描述（英文）和一句图片描述（alt，原文语言）。
 * 为什么不把文章直接交给图像模型：图像模型擅长"画出描述的东西"，不擅长"读懂一篇长文、想一个视觉比喻"；
 * 中间多一步还让作者看得到、改得了要画什么，不满意时不必花出图的钱。
 *
 * 这个模块只管"怎么调 API"；路由经 CoverBriefWriter 接口使用它，测试注入假实现。
 */

export type CoverBriefJob = {
  /** 文章原文的语言：alt 用这种语言写（媒体库里的描述和后台其他内容一样是原文语言） */
  sourceLocale: Locale;
  title: string;
  tags: readonly string[];
  contentMd: string;
  /** 作者给的方向，可能为空 */
  direction: string;
  /** 设置里的头图风格 */
  style: string;
};

export type CoverBriefOutcome = TranslationStop & { text: string };

export type CoverBriefWriter = {
  writeBrief(job: CoverBriefJob, options: { signal: AbortSignal; model: TranslationModelId }): Promise<CoverBriefOutcome>;
};

/** 输出只有一两百个 token，余量留给思考（思考计入 max_tokens） */
export const COVER_BRIEF_MAX_TOKENS = 8_000;

/** 截到 max 个 UTF-16 码元，不把代理对（emoji 等）切成两半 */
export function truncateSource(text: string, max = COVER_SOURCE_MAX_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

export function coverBriefSystemPrompt(sourceLocale: Locale, style: string): string {
  return [
    "You are the art director of a personal technical blog. For each post you design the cover image and write the prompt that an image generation model will render.",
    "",
    "How to work:",
    "- Find the single core idea of the post, then choose one concrete, striking visual metaphor that a reader would connect with the topic at a glance.",
    "- Describe what the image shows, not what the post says: the subject, composition, viewpoint, colors, lighting and rendering style, concretely.",
    "- Follow the art direction below. Do not repeat it: it is sent to the image model together with your prompt.",
    "- If the image should contain any words, give them in double quotes exactly as they must appear, and obey the text rules of the art direction.",
    "- Avoid real people's likenesses, real company logos and trademarks, user interfaces full of small text, stock-photo clichés (handshakes, people at laptops) and cluttered collages.",
    "- If the author gives a direction, follow it.",
    "",
    "Output:",
    "- prompt: in English, 40 to 120 words, one paragraph.",
    `- alt: in ${languageName(sourceLocale)}, one sentence of at most 80 characters describing what the image shows, for screen reader users.`,
    "",
    "Art direction:",
    style,
  ].join("\n");
}

export const coverBriefOutputSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "The image generation prompt, in English" },
    alt: { type: "string", description: "Alt text describing the image" },
  },
  required: ["prompt", "alt"],
  additionalProperties: false,
};

type MessageRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export function buildCoverBriefRequest(model: TranslationModelId, job: CoverBriefJob): MessageRequest {
  const source = truncateSource(job.contentMd);
  const content = [
    "<title>",
    job.title,
    "</title>",
    ...(job.tags.length > 0 ? ["<tags>", job.tags.join(", "), "</tags>"] : []),
    "<article>",
    source.text,
    ...(source.truncated ? ["[… the rest of the article is omitted]"] : []),
    "</article>",
    ...(job.direction ? ["<author_direction>", job.direction, "</author_direction>"] : []),
  ].join("\n");
  return {
    model,
    max_tokens: COVER_BRIEF_MAX_TOKENS,
    // 结构化输出，不用服务端回退（和标签名一样：文档没确认回退模型支持结构化输出）
    thinking: { type: "adaptive" },
    // 要一点构思，但不必像翻译那样逐字推敲
    output_config: { effort: "medium", format: { type: "json_schema", schema: coverBriefOutputSchema } },
    system: coverBriefSystemPrompt(job.sourceLocale, job.style),
    messages: [{ role: "user", content }],
  };
}

/**
 * 解析模型的输出。带了 JSON Schema 也要校验：截断或拒答时输出可能不符合 schema。
 * alt 超长时截断（它只是描述，不值得为此失败）；画面描述超长则报错（截断会切掉半句画面）。
 */
export function parseCoverBriefOutput(text: string): { prompt: string; alt: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("模型返回的不是合法的 JSON");
  }
  const parsed = z.object({ prompt: z.string().trim().min(1), alt: z.string().trim() }).safeParse(json);
  if (!parsed.success) throw new Error("模型返回的画面描述不完整");
  const { prompt, alt } = parsed.data;
  if (prompt.length > COVER_PROMPT_MAX_LENGTH) throw new Error(`模型写的画面描述太长（超过 ${COVER_PROMPT_MAX_LENGTH} 字）`);
  return { prompt, alt: alt.length > COVER_ALT_MAX_LENGTH ? `${alt.slice(0, COVER_ALT_MAX_LENGTH - 1)}…` : alt };
}

type Options = {
  /** 测试用：替换 SDK 发请求用的 fetch */
  fetch?: typeof fetch;
  maxRetries?: number;
};

export function createAnthropicCoverBriefWriter(apiKey: string, options: Options = {}): CoverBriefWriter {
  const client = new Anthropic({
    apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });
  return {
    async writeBrief(job, { signal, model }) {
      const message = await client.beta.messages.create(buildCoverBriefRequest(model, job), { signal });
      return { text: textOf(message), ...stopOf(message) };
    },
  };
}

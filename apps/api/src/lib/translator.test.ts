import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  buildSegmentRequest,
  buildTagNameRequest,
  buildTitleRequest,
  classifyTranslatorError,
  cleanTranslatedTitle,
  createAnthropicTranslator,
  languageName,
  parseTagNameOutput,
  type SegmentEvent,
  TAG_NAME_MAX_TOKENS,
  type TagNameJob,
  tagNameStyles,
  SEGMENT_MAX_TOKENS,
  SERVER_SIDE_FALLBACK_BETA,
  sourceDocument,
  stopReasonMessage,
  TITLE_MAX_TOKENS,
  TRANSLATION_MODEL,
  type TranslationJob,
  translationStyles,
  translationSystemPrompt,
  servedByFallback,
  usageFrom,
} from "./translator.ts";

const job: TranslationJob = {
  sourceLocale: "zh",
  targetLocale: "ja",
  title: "用 Hono 写 API",
  contentMd: "第一段。\n\n```ts\nconst a = 1;\n```\n\n第二段。\n",
};
const segment = { index: 1, total: 3, text: "```ts\nconst a = 1;\n```\n\n" };

/** 请求参数里的 user content blocks */
function userBlocks(request: ReturnType<typeof buildTitleRequest>) {
  const [message] = request.messages;
  if (!message || typeof message.content === "string") throw new Error("expected content blocks");
  return message.content;
}

describe("request builders", () => {
  it("use the chosen model, adaptive thinking at high effort and the default server-side fallback", () => {
    for (const request of [buildTitleRequest(job), buildSegmentRequest(job, segment)]) {
      expect(request.model).toBe("claude-sonnet-5-5");
      expect(request.model).toBe(TRANSLATION_MODEL);
      expect(request.thinking).toEqual({ type: "adaptive" });
      expect(request.output_config).toEqual({ effort: "high" });
      // "default" 形式必须配这个 beta 头（数组形式的头会 400）
      expect(request.fallbacks).toBe("default");
      expect(request.betas).toEqual([SERVER_SIDE_FALLBACK_BETA]);
      expect(SERVER_SIDE_FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
      // 采样参数非默认值会 400；也不能用 assistant 预填
      expect(request).not.toHaveProperty("temperature");
      expect(request).not.toHaveProperty("top_p");
      expect(request).not.toHaveProperty("top_k");
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0]?.role).toBe("user");
    }
  });

  it("give segments room to stream and titles room to think", () => {
    expect(buildSegmentRequest(job, segment).max_tokens).toBe(64_000);
    expect(SEGMENT_MAX_TOKENS).toBe(64_000);
    expect(buildTitleRequest(job).max_tokens).toBe(TITLE_MAX_TOKENS);
    expect(TITLE_MAX_TOKENS).toBe(4_000);
    expect(TITLE_MAX_TOKENS).toBeLessThan(SEGMENT_MAX_TOKENS);
  });

  it("share a byte-identical prefix (system + whole article, cache breakpoint on the article) across title and segments", () => {
    const title = buildTitleRequest(job);
    const first = buildSegmentRequest(job, { index: 0, total: 3, text: "第一段。\n\n" });
    const second = buildSegmentRequest(job, segment);
    expect(first.system).toBe(title.system);
    expect(second.system).toBe(title.system);

    const [titleDoc, titleTask] = userBlocks(title);
    const [firstDoc, firstTask] = userBlocks(first);
    const [secondDoc, secondTask] = userBlocks(second);
    expect(titleDoc).toEqual({ type: "text", text: sourceDocument(job), cache_control: { type: "ephemeral" } });
    expect(firstDoc).toEqual(titleDoc);
    expect(secondDoc).toEqual(titleDoc);
    // 指令在缓存断点之后，且不带 cache_control（否则每个请求各写一份缓存，永远读不到）
    for (const task of [titleTask, firstTask, secondTask]) {
      expect(task).toMatchObject({ type: "text" });
      expect(task).not.toHaveProperty("cache_control");
    }
    expect(userBlocks(title)).toHaveLength(2);
    expect(JSON.stringify(firstTask)).not.toBe(JSON.stringify(secondTask));
  });

  it("put the whole article in the shared block and only the requested part in the task", () => {
    const doc = sourceDocument(job);
    expect(doc).toContain(job.title);
    expect(doc).toContain(job.contentMd);
    const [, task] = userBlocks(buildSegmentRequest(job, segment));
    if (task?.type !== "text") throw new Error("expected text");
    expect(task.text).toContain("part 2 of 3");
    expect(task.text).toContain(`<part>\n${segment.text}\n</part>`);
    expect(task.text).toContain("Japanese");
    const [, titleTask] = userBlocks(buildTitleRequest(job));
    if (titleTask?.type !== "text") throw new Error("expected text");
    expect(titleTask.text).toContain("title");
    expect(titleTask.text).toContain("into Japanese");
    expect(titleTask.text).not.toContain(job.contentMd);
  });
});

describe("translationSystemPrompt", () => {
  it("is stable: the same language pair always gives the same bytes, with nothing per-request in it", () => {
    expect(translationSystemPrompt("zh", "ja")).toBe(translationSystemPrompt("zh", "ja"));
    expect(translationSystemPrompt("zh", "ja")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(translationSystemPrompt("zh", "ja")).not.toBe(translationSystemPrompt("zh", "en"));
  });

  it("names the languages from their BCP 47 tags and adds the target's style", () => {
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("en")).toBe("English");
    expect(languageName("zh")).toMatch(/^Chinese/);
    const ja = translationSystemPrompt("zh", "ja");
    expect(ja).toContain("into Japanese");
    expect(ja).toContain(`written in ${languageName("zh")}`);
    expect(ja).toContain("です・ます");
    expect(translationSystemPrompt("zh", "en")).toContain("into English");
  });

  it("tells the model what must survive untouched", () => {
    const prompt = translationSystemPrompt("zh", "en");
    for (const phrase of ["code blocks", "inline code", "URLs", "#fragment", "raw HTML", "footnote labels", "Output only the translation"]) {
      expect(prompt).toContain(phrase);
    }
  });

  it("tells the model to copy URLs exactly and to end bare URLs explicitly (the structure check takes the translation's links as rendered)", () => {
    const prompt = translationSystemPrompt("zh", "ja");
    expect(prompt).toContain("- Copy every URL exactly, character for character.");
    expect(prompt).toContain("wrap it in <...> or put a space after it, so that the link ends exactly where the URL ends");
    // 规则是固定文字：系统提示只由语言对决定，前缀逐字节相同才能命中缓存
    expect(translationSystemPrompt("zh", "ja")).toBe(prompt);
    expect(translationSystemPrompt("zh", "en").replace("into English", "into Japanese").replace(translationStyles.en, translationStyles.ja)).toBe(prompt);
  });
});

describe("cleanTranslatedTitle", () => {
  it.each([
    ["  Writing an API with Hono \n", "Writing an API with Hono"],
    ['"Writing an API"', "Writing an API"],
    ["「HonoでAPIを書く」", "HonoでAPIを書く"],
    ["『HonoでAPIを書く』", "HonoでAPIを書く"],
    ["“Quoted”", "Quoted"],
    ["‘Quoted’", "Quoted"],
    ["'Single'", "Single"],
    ["# Heading Title", "Heading Title"],
    ["Line one\n  line two", "Line one line two"],
    ['" spaced "', "spaced"],
    ['"Unbalanced', '"Unbalanced'],
    ['"', '"'],
  ])("cleans %j", (raw, expected) => {
    expect(cleanTranslatedTitle(raw, "用 Hono 写 API")).toBe(expected);
  });

  it("keeps quotes and heading marks that the source title itself has", () => {
    expect(cleanTranslatedTitle("「Quoted」", "「引用」")).toBe("「Quoted」");
    expect(cleanTranslatedTitle("# 1 rule", "# 1 条规则")).toBe("# 1 rule");
  });
});

describe("usageFrom", () => {
  const base = { input_tokens: 10, output_tokens: 20, cache_creation: null, server_tool_use: null, service_tier: null, inference_geo: null } as const;

  it("maps the SDK's usage and turns missing cache counts into 0", () => {
    expect(usageFrom({ ...base, cache_read_input_tokens: null, cache_creation_input_tokens: null } as Anthropic.Beta.Messages.BetaUsage)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(usageFrom({ ...base, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 } as Anthropic.Beta.Messages.BetaUsage)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 7,
    });
    expect(servedByFallback({ ...base, iterations: null } as Anthropic.Beta.Messages.BetaUsage)).toBe(false);
  });

  it("uses the top-level counts when there are no billed iterations", () => {
    const usage = { ...base, cache_read_input_tokens: 5, cache_creation_input_tokens: null, iterations: [] } as unknown as Anthropic.Beta.Messages.BetaUsage;
    expect(usageFrom(usage)).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 5, cacheCreationInputTokens: 0 });
  });

  it("adds up every billed attempt of a server-side fallback (the declined attempt is billed too)", () => {
    const attempt = (type: string, model: string, input: number, output: number, read: number, write: number) => ({
      type,
      model,
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: read,
      cache_creation_input_tokens: write,
      cache_creation: null,
    });
    // 顶层只有回退那次（Sonnet 5）的用量；Sonnet 5.5 拒答之前的输出只在 iterations 里
    const usage = {
      ...base,
      input_tokens: 7,
      output_tokens: 300,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 900,
      iterations: [
        attempt("message", "claude-sonnet-5-5", 5, 120, 800, 0),
        attempt("fallback_message", "claude-sonnet-5", 7, 300, 0, 900),
        // compaction 不计入顶层用量（翻译用不到，出现了也不加）
        { type: "compaction", input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 1000, cache_creation: null },
      ],
    } as unknown as Anthropic.Beta.Messages.BetaUsage;
    expect(usageFrom(usage)).toEqual({ inputTokens: 12, outputTokens: 420, cacheReadInputTokens: 800, cacheCreationInputTokens: 900 });
    expect(servedByFallback(usage)).toBe(true);
    // 没有回退（只有一条 message）：和顶层一样
    const single = { ...base, iterations: [attempt("message", "claude-sonnet-5-5", 10, 20, 3, 4)] } as unknown as Anthropic.Beta.Messages.BetaUsage;
    expect(usageFrom(single)).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 });
    expect(servedByFallback(single)).toBe(false);
  });
});

describe("stopReasonMessage", () => {
  it("explains refusals (with the category when there is one), truncation and anything else", () => {
    expect(stopReasonMessage("refusal", "cyber")).toBe("模型拒绝翻译这部分内容（类别：cyber）");
    expect(stopReasonMessage("refusal", null)).toBe("模型拒绝翻译这部分内容");
    expect(stopReasonMessage("max_tokens", null)).toContain("截断");
    expect(stopReasonMessage("pause_turn", null)).toContain("pause_turn");
  });
});

describe("classifyTranslatorError", () => {
  const headers = new Headers();
  const apiError = (status: number) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "upstream says no" } }, undefined, headers);

  it("treats a client abort as aborted, not as a failure", () => {
    expect(classifyTranslatorError(new Anthropic.APIUserAbortError())).toMatchObject({ aborted: true });
  });

  it.each([
    ["invalid key", 401],
    ["no permission", 403],
  ])("hides credential problems (%s) behind a 502", (_name, status) => {
    const failure = classifyTranslatorError(apiError(status));
    expect(failure).toMatchObject({ status: 502, code: "internal_error", aborted: false });
    expect(failure.message).toContain("凭证");
    expect(failure.message).not.toContain("upstream says no");
  });

  it("passes upstream rate limiting on as 429", () => {
    expect(classifyTranslatorError(apiError(429))).toMatchObject({ status: 429, code: "rate_limited", aborted: false });
  });

  it.each([
    ["billing", 402, "账单"],
    ["server error", 500, "暂时不可用"],
    ["overloaded", 529, "暂时不可用"],
    ["bad request", 400, "拒绝了请求"],
    ["model not found", 404, "拒绝了请求"],
  ])("maps %s to 502", (_name, status, text) => {
    const failure = classifyTranslatorError(apiError(status));
    expect(failure).toMatchObject({ status: 502, code: "internal_error", aborted: false });
    expect(failure.message).toContain(text);
  });

  describe("errors that arrive inside the stream (no HTTP status, only error.type)", () => {
    const streamError = (type: string) =>
      new Anthropic.APIError(undefined, { type: "error", error: { type, message: "upstream says no" } }, undefined, new Headers(), type as InstanceType<typeof Anthropic.APIError>["type"]);

    it.each([
      ["overloaded_error", 502, "暂时不可用"],
      ["api_error", 502, "暂时不可用"],
      ["timeout_error", 502, "暂时不可用"],
      ["billing_error", 502, "账单"],
      ["authentication_error", 502, "凭证"],
      ["permission_error", 502, "凭证"],
      ["invalid_request_error", 502, "拒绝了请求"],
      ["not_found_error", 502, "拒绝了请求"],
      ["something_new", 502, "暂时不可用"],
    ])("maps %s", (type, status, text) => {
      const failure = classifyTranslatorError(streamError(type));
      expect(streamError(type).status).toBeUndefined();
      expect(failure).toMatchObject({ status, code: "internal_error", aborted: false });
      expect(failure.message).toContain(text);
      expect(failure.message).not.toContain("upstream says no");
    });

    it("passes a mid-stream rate limit on as 429", () => {
      expect(classifyTranslatorError(streamError("rate_limit_error"))).toMatchObject({ status: 429, code: "rate_limited", aborted: false });
    });
  });

  it("maps connection failures and timeouts to 502", () => {
    expect(classifyTranslatorError(new Anthropic.APIConnectionError({ message: "down" }))).toMatchObject({ status: 502, aborted: false });
    expect(classifyTranslatorError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ status: 502, aborted: false });
    expect(classifyTranslatorError(new Anthropic.APIConnectionError({ message: "down" })).message).toContain("连接");
  });

  it("maps anything else to a plain 500", () => {
    expect(classifyTranslatorError(new Error("bug"))).toEqual({ status: 500, code: "internal_error", message: "服务器内部错误", aborted: false });
    expect(classifyTranslatorError("weird")).toMatchObject({ status: 500, aborted: false });
  });
});

// ---------- 真实现：SDK 走一个伪造的 fetch，验证我们对 SDK 的用法（绝不连真 API） ----------

type Captured = { url: string; headers: Headers; body: Record<string, unknown>; signal: AbortSignal | null };

function sse(events: object[]): Response {
  const text = events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
}

const messageStart = (model = TRANSLATION_MODEL) => ({
  type: "message_start",
  message: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 12, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null },
  },
});

const textBlock = (index: number, ...deltas: string[]) => [
  { type: "content_block_start", index, content_block: { type: "text", text: "" } },
  ...deltas.map((text) => ({ type: "content_block_delta", index, delta: { type: "text_delta", text } })),
  { type: "content_block_stop", index },
];

const messageEnd = (stopReason: string, stopDetails: object | null = null) => [
  {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails },
    usage: { output_tokens: 34, input_tokens: 12, cache_read_input_tokens: 800, cache_creation_input_tokens: null },
  },
  { type: "message_stop" },
];

function fakeFetch(respond: (captured: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const captured = {
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      signal: init?.signal ?? null,
    };
    calls.push(captured);
    return respond(captured);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function collect(events: AsyncIterable<SegmentEvent>): Promise<SegmentEvent[]> {
  const result: SegmentEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe("createAnthropicTranslator", () => {
  const signal = () => new AbortController().signal;

  it("streams a segment: start, text deltas only (no thinking), then done with stop reason, model and usage", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      sse([
        messageStart(),
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "internal reasoning" } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
        { type: "content_block_stop", index: 0 },
        ...textBlock(1, "```ts\n", "const a = 1;\n```"),
        ...messageEnd("end_turn"),
      ]),
    );
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const events = await collect(translator.streamSegment(job, segment, { signal: signal() }));

    expect(events).toEqual([
      { type: "start" },
      { type: "delta", text: "```ts\n" },
      { type: "delta", text: "const a = 1;\n```" },
      {
        type: "done",
        text: "```ts\nconst a = 1;\n```",
        stopReason: "end_turn",
        refusalCategory: null,
        model: TRANSLATION_MODEL,
        usage: { inputTokens: 12, outputTokens: 34, cacheReadInputTokens: 800, cacheCreationInputTokens: 0 },
        fallback: false,
      },
    ]);

    // 发出去的请求：beta 接口、beta 头、参数与纯函数构造的一致（流式）
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(call?.headers.get("anthropic-beta")).toBe(SERVER_SIDE_FALLBACK_BETA);
    expect(call?.headers.get("x-api-key")).toBe("test-key");
    const { betas: _betas, ...expected } = buildSegmentRequest(job, segment);
    expect(call?.body).toEqual({ ...expected, stream: true });
  });

  it("records the model that actually served a mid-stream fallback, and joins the text across it", async () => {
    const { fetchImpl } = fakeFetch(() =>
      sse([
        messageStart(),
        ...textBlock(0, "Hello "),
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "fallback", from: { model: TRANSLATION_MODEL }, to: { model: "claude-sonnet-5" }, trigger: { type: "refusal" } },
        },
        { type: "content_block_stop", index: 1 },
        ...textBlock(2, "world"),
        ...messageEnd("end_turn"),
      ]),
    );
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const events = await collect(translator.streamSegment(job, segment, { signal: signal() }));
    expect(events.at(-1)).toMatchObject({ type: "done", text: "Hello world", model: "claude-sonnet-5", stopReason: "end_turn" });
  });

  it("reports a refusal with its category", async () => {
    const { fetchImpl } = fakeFetch(() =>
      sse([messageStart(), ...textBlock(0, "部分"), ...messageEnd("refusal", { type: "refusal", category: "cyber", explanation: null })]),
    );
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const events = await collect(translator.streamSegment(job, segment, { signal: signal() }));
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "refusal", refusalCategory: "cyber" });
  });

  it("reports an error event inside the stream (after HTTP 200) as temporarily unavailable, not as a rejected request", async () => {
    const { fetchImpl } = fakeFetch(() =>
      sse([messageStart(), ...textBlock(0, "Hel").slice(0, 2), { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]),
    );
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const seen: SegmentEvent[] = [];
    const error = await (async () => {
      for await (const event of translator.streamSegment(job, segment, { signal: signal() })) seen.push(event);
    })().then(
      () => null,
      (e: unknown) => e,
    );
    expect(seen).toEqual([{ type: "start" }, { type: "delta", text: "Hel" }]);
    expect(error).toBeInstanceOf(Anthropic.APIError);
    expect((error as InstanceType<typeof Anthropic.APIError>).status).toBeUndefined();
    expect(classifyTranslatorError(error)).toMatchObject({ status: 502, message: "翻译服务暂时不可用，请稍后再试", aborted: false });
  });

  it("never treats a missing stop reason as success", async () => {
    // 流里没有 message_delta：stop_reason 一直是 null
    const { fetchImpl } = fakeFetch(() => sse([messageStart(), ...textBlock(0, "部分"), { type: "message_stop" }]));
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const events = await collect(translator.streamSegment(job, segment, { signal: signal() }));
    expect(events.at(-1)).toMatchObject({ type: "done", text: "部分", stopReason: "unknown", refusalCategory: null });
    expect(stopReasonMessage("unknown", null)).toContain("没有正常结束");
  });

  it("reports the summed usage and the fallback flag of a fallback-served segment", async () => {
    const iterations = [
      { type: "message", model: TRANSLATION_MODEL, input_tokens: 12, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 0, cache_creation: null },
      { type: "fallback_message", model: "claude-sonnet-5", input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 0, cache_creation_input_tokens: 820, cache_creation: null },
    ];
    const [delta, stop] = messageEnd("end_turn");
    const { fetchImpl } = fakeFetch(() =>
      sse([
        messageStart("claude-sonnet-5"),
        ...textBlock(0, "Hello"),
        { ...delta, usage: { output_tokens: 34, input_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 820, iterations } },
        stop ?? { type: "message_stop" },
      ]),
    );
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const events = await collect(translator.streamSegment(job, segment, { signal: signal() }));
    expect(events.at(-1)).toMatchObject({
      type: "done",
      model: "claude-sonnet-5",
      fallback: true,
      usage: { inputTokens: 24, outputTokens: 84, cacheReadInputTokens: 800, cacheCreationInputTokens: 820 },
    });
  });

  it("throws the SDK's typed error when the API rejects the request", async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    const translator = createAnthropicTranslator("bad-key", { fetch: fetchImpl, maxRetries: 0 });
    await expect(collect(translator.streamSegment(job, segment, { signal: signal() }))).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
    await expect(translator.translateTitle(job, { signal: signal() })).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
  });

  it("aborts the upstream request when the signal fires", async () => {
    const encoder = new TextEncoder();
    let fetchSignal: AbortSignal | null = null;
    const { fetchImpl } = fakeFetch((captured) => {
      fetchSignal = captured.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const event of [messageStart(), ...textBlock(0, "Hel").slice(0, 2)]) {
              controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
            }
            // 之后不再发数据（模拟模型还在生成）；像真的 fetch 一样，请求被中止时读取响应体失败
            captured.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const controller = new AbortController();
    const seen: SegmentEvent[] = [];
    const run = (async () => {
      for await (const event of translator.streamSegment(job, segment, { signal: controller.signal })) {
        seen.push(event);
        if (event.type === "delta") controller.abort();
      }
    })();
    await expect(run).rejects.toBeInstanceOf(Anthropic.APIUserAbortError);
    expect(seen).toEqual([{ type: "start" }, { type: "delta", text: "Hel" }]);
    // SDK 发请求用的 signal 被中止：真实的 fetch 会因此断开与 API 的连接，不再计费
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("aborts the upstream request when the consumer stops iterating early", async () => {
    const encoder = new TextEncoder();
    let fetchSignal: AbortSignal | null = null;
    const { fetchImpl } = fakeFetch((captured) => {
      fetchSignal = captured.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const event of [messageStart(), ...textBlock(0, "Hel").slice(0, 2)]) {
              controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
            }
            captured.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    for await (const event of translator.streamSegment(job, segment, { signal: new AbortController().signal })) {
      if (event.type === "delta") break;
    }
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("translates a title with a non-streaming request", async () => {
    const { fetchImpl, calls } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            id: "msg_t",
            type: "message",
            role: "assistant",
            model: TRANSLATION_MODEL,
            content: [
              { type: "thinking", thinking: "", signature: "sig" },
              { type: "text", text: "「HonoでAPIを書く」" },
            ],
            stop_reason: "end_turn",
            stop_sequence: null,
            stop_details: null,
            usage: { input_tokens: 900, output_tokens: 20, cache_creation_input_tokens: 850, cache_read_input_tokens: null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    expect(translator.model).toBe(TRANSLATION_MODEL);
    const outcome = await translator.translateTitle(job, { signal: signal() });
    expect(outcome).toEqual({
      text: "「HonoでAPIを書く」",
      stopReason: "end_turn",
      refusalCategory: null,
      model: TRANSLATION_MODEL,
      usage: { inputTokens: 900, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 850 },
      fallback: false,
    });
    const { betas: _betas, ...expected } = buildTitleRequest(job);
    expect(calls[0]?.body).toEqual(expected);
    expect(calls[0]?.headers.get("anthropic-beta")).toBe(SERVER_SIDE_FALLBACK_BETA);
  });

  it("names a tag with one plain (non-beta-header) JSON request", async () => {
    const { fetchImpl, calls } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            id: "msg_tag",
            type: "message",
            role: "assistant",
            model: TRANSLATION_MODEL,
            content: [
              { type: "thinking", thinking: "", signature: "sig" },
              { type: "text", text: '{"en":"Typography","ja":"タイポグラフィ"}' },
            ],
            stop_reason: "end_turn",
            stop_sequence: null,
            stop_details: null,
            usage: { input_tokens: 200, output_tokens: 15, cache_creation_input_tokens: null, cache_read_input_tokens: null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const translator = createAnthropicTranslator("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const outcome = await translator.translateTagName(tagJob, { signal: signal() });
    expect(outcome).toMatchObject({ text: '{"en":"Typography","ja":"タイポグラフィ"}', stopReason: "end_turn", model: TRANSLATION_MODEL });
    expect(calls[0]?.body).toEqual(buildTagNameRequest(tagJob));
    expect(calls[0]?.headers.get("anthropic-beta")).toBeNull();
  });
});

const tagJob: TagNameJob = {
  sourceLocale: "zh",
  targetLocales: ["en", "ja"],
  name: "排版",
  slug: "typography",
  glossary: [{ name: "设计", translations: { en: "Design", ja: "デザイン" } }],
};

describe("buildTagNameRequest", () => {
  it("asks for a JSON object with exactly one string per target language", () => {
    const request = buildTagNameRequest(tagJob);
    expect(request).toMatchObject({ model: TRANSLATION_MODEL, max_tokens: TAG_NAME_MAX_TOKENS, thinking: { type: "adaptive" } });
    expect(request.output_config).toEqual({
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { en: { type: "string", description: "The tag name in English" }, ja: { type: "string", description: "The tag name in Japanese" } },
          required: ["en", "ja"],
          additionalProperties: false,
        },
      },
    });
    // 结构化输出和服务端回退的兼容性没有文档确认：不用回退
    expect(request).not.toHaveProperty("fallbacks");
    expect(request).not.toHaveProperty("betas");
  });

  it("gives the name, the slug hint, the existing tags and each language's naming style", () => {
    const request = buildTagNameRequest(tagJob);
    expect(request.messages).toEqual([
      { role: "user", content: "Existing tags on this blog, for consistent style:\n- 设计: en=Design, ja=デザイン\n\nTag: 排版\nIts URL slug (often an English hint of the meaning): typography" },
    ]);
    expect(request.system).toContain(`- English: ${tagNameStyles.en}`);
    expect(request.system).toContain(`- Japanese: ${tagNameStyles.ja}`);
    expect(request.system).not.toContain(tagNameStyles.zh);
  });

  it("leaves out the glossary and slug when there are none", () => {
    expect(buildTagNameRequest({ ...tagJob, slug: "", glossary: [] }).messages).toEqual([{ role: "user", content: "Tag: 排版" }]);
  });
});

describe("parseTagNameOutput", () => {
  it("trims each name", () => {
    expect(parseTagNameOutput('{"en":" Typography ","ja":"タイポグラフィ"}', ["en", "ja"])).toEqual({ en: "Typography", ja: "タイポグラフィ" });
  });

  it.each([
    ["not JSON", "Typography", "不是合法的 JSON"],
    ["a missing language", '{"en":"Typography"}', "不完整"],
    ["an empty name", '{"en":"  ","ja":"x"}', "不完整"],
    ["a name that is too long", `{"en":"${"x".repeat(51)}","ja":"x"}`, "不完整"],
  ])("rejects %s", (_name, text, message) => {
    expect(() => parseTagNameOutput(text, ["en", "ja"])).toThrow(message);
  });
});

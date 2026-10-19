import { COVER_PROMPT_MAX_LENGTH, COVER_SOURCE_MAX_CHARS, DEFAULT_TRANSLATION_MODEL } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { buildCoverBriefRequest, type CoverBriefJob, createAnthropicCoverBriefWriter, parseCoverBriefOutput, truncateSource } from "./cover-brief.ts";

const job: CoverBriefJob = {
  sourceLocale: "zh",
  title: "缓存的三种失效",
  tags: ["性能", "Next.js"],
  contentMd: "正文。",
  direction: "用钥匙比喻",
  style: "Bold 3D render.",
};

describe("buildCoverBriefRequest", () => {
  it("sends the style in the system prompt and the post in the user message, with a JSON schema", () => {
    const req = buildCoverBriefRequest("claude-haiku-5-5", job);
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.system).toContain("Art direction:\nBold 3D render.");
    // alt 用原文语言写
    expect(req.system).toContain("alt: in Chinese");
    expect(req.messages[0]?.content).toBe(
      ["<title>", "缓存的三种失效", "</title>", "<tags>", "性能, Next.js", "</tags>", "<article>", "正文。", "</article>", "<author_direction>", "用钥匙比喻", "</author_direction>"].join("\n"),
    );
    expect(req.output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    // 结构化输出不带服务端回退；不发采样参数
    expect(req).not.toHaveProperty("fallbacks");
    expect(req).not.toHaveProperty("temperature");
  });

  it("leaves out empty tags and direction, and marks a truncated article", () => {
    const content = buildCoverBriefRequest(DEFAULT_TRANSLATION_MODEL, { ...job, tags: [], direction: "", contentMd: "字".repeat(COVER_SOURCE_MAX_CHARS + 10) }).messages[0]?.content;
    expect(content).not.toContain("<tags>");
    expect(content).not.toContain("<author_direction>");
    expect(content).toContain("[… the rest of the article is omitted]");
  });
});

describe("truncateSource", () => {
  it("keeps short text and never splits a surrogate pair", () => {
    expect(truncateSource("abc", 5)).toEqual({ text: "abc", truncated: false });
    expect(truncateSource("ab😀cd", 3)).toEqual({ text: "ab", truncated: true });
    expect(truncateSource("abcd", 3)).toEqual({ text: "abc", truncated: true });
  });
});

describe("parseCoverBriefOutput", () => {
  it("trims the fields", () => {
    expect(parseCoverBriefOutput('{"prompt":"  A key. ","alt":" 钥匙 "}')).toEqual({ prompt: "A key.", alt: "钥匙" });
  });

  it("rejects invalid JSON, a missing prompt and an overlong prompt", () => {
    expect(() => parseCoverBriefOutput("{")).toThrow("模型返回的不是合法的 JSON");
    expect(() => parseCoverBriefOutput('{"prompt":" ","alt":"x"}')).toThrow("模型返回的画面描述不完整");
    expect(() => parseCoverBriefOutput(JSON.stringify({ prompt: "a".repeat(COVER_PROMPT_MAX_LENGTH + 1), alt: "" }))).toThrow("太长");
  });

  it("shortens an overlong alt instead of failing", () => {
    const { alt } = parseCoverBriefOutput(JSON.stringify({ prompt: "p", alt: "长".repeat(600) }));
    expect(alt).toHaveLength(500);
    expect(alt.endsWith("…")).toBe(true);
  });
});

describe("createAnthropicCoverBriefWriter", () => {
  it("calls the Messages API and returns the text with the stop reason and usage", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [{ type: "text", text: '{"prompt":"A key.","alt":"钥匙"}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          stop_details: null,
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const writer = createAnthropicCoverBriefWriter("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const outcome = await writer.writeBrief(job, { signal: new AbortController().signal, model: "claude-haiku-5-5" });
    expect(outcome).toEqual({
      text: '{"prompt":"A key.","alt":"钥匙"}',
      stopReason: "end_turn",
      refusalCategory: null,
      model: "claude-haiku-5-5",
      usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      fallback: false,
    });
    expect(bodies[0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 8000 });
  });
});

import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import {
  buildCoverImageRequest,
  classifyImagerError,
  type CoverImageEvent,
  type CoverImageRequest,
  coverImagePrompt,
  createOpenAiCoverImager,
  PARTIAL_IMAGES,
} from "./cover-imager.ts";

const request: CoverImageRequest = {
  prompt: "A giant glowing key.",
  style: "Bold 3D render.",
  model: "gpt-image-2.5-flare",
  quality: "medium",
  safetyIdentifier: "abc123",
};

describe("buildCoverImageRequest", () => {
  it("asks for a streamed 16:9 WebP with previews, the style before the scene", () => {
    expect(buildCoverImageRequest(request)).toEqual({
      model: "gpt-image-2.5-flare",
      prompt: "Bold 3D render.\n\nThe image to create:\nA giant glowing key.",
      size: "1536x864",
      quality: "medium",
      output_format: "webp",
      output_compression: 90,
      background: "opaque",
      n: 1,
      stream: true,
      partial_images: PARTIAL_IMAGES,
      safety_identifier: "abc123",
    });
  });

  it("trims both parts", () => {
    expect(coverImagePrompt("  style \n", "\n scene ")).toBe("style\n\nThe image to create:\nscene");
  });
});

describe("classifyImagerError", () => {
  const headers = new Headers();

  it("treats a moderation block as the author's to fix (400), not an outage", () => {
    expect(classifyImagerError(new OpenAI.BadRequestError(400, { code: "moderation_blocked" }, "blocked", headers))).toMatchObject({ status: 400, code: "validation_error" });
    // 流开始后上游发来的同类错误：没有 status，只有 code
    expect(classifyImagerError(new OpenAI.APIError(undefined, { code: "moderation_blocked" }, "blocked", undefined))).toMatchObject({ status: 400 });
  });

  it("separates an exhausted quota from ordinary upstream rate limiting", () => {
    expect(classifyImagerError(new OpenAI.RateLimitError(429, { code: "insufficient_quota" }, "quota", headers))).toMatchObject({ status: 502, message: expect.stringContaining("额度") });
    expect(classifyImagerError(new OpenAI.RateLimitError(429, { code: "rate_limit_exceeded" }, "slow down", headers))).toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("explains credentials and organization verification problems without leaking upstream details", () => {
    expect(classifyImagerError(new OpenAI.AuthenticationError(401, {}, "Incorrect API key provided: sk-…", headers)).message).toBe("OpenAI 的密钥无效（详见服务器日志）");
    expect(classifyImagerError(new OpenAI.PermissionDeniedError(403, {}, "verify org", headers)).message).toContain("组织还没有完成验证");
  });

  it("classifies aborts, connection failures, server errors and unknown errors", () => {
    expect(classifyImagerError(new OpenAI.APIUserAbortError()).aborted).toBe(true);
    expect(classifyImagerError(new OpenAI.APIConnectionError({ message: "down" }))).toMatchObject({ status: 502, message: "连接 OpenAI 失败，请稍后再试" });
    expect(classifyImagerError(new OpenAI.InternalServerError(500, {}, "oops", headers))).toMatchObject({ status: 502, message: "OpenAI 图像服务暂时不可用，请稍后再试" });
    expect(classifyImagerError(new Error("bug"))).toMatchObject({ status: 500, message: "服务器内部错误" });
  });
});

// ---------- 真实现：SDK 走一个伪造的 fetch（绝不连真 API） ----------

type Captured = { url: string; method: string; headers: Headers; body: Record<string, unknown> | null; signal: AbortSignal | null };

function fakeFetch(respond: (captured: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const captured = {
      url: String(input instanceof Request ? input.url : input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body === undefined || init.body === null ? null : (JSON.parse(String(init.body)) as Record<string, unknown>),
      signal: init?.signal ?? null,
    };
    calls.push(captured);
    return respond(captured);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const common = { background: "opaque", created_at: 1, output_format: "webp", quality: "medium", size: "1536x864" };

function sse(...chunks: string[]) {
  return new Response(chunks.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function collect(events: AsyncIterable<CoverImageEvent>) {
  const result: CoverImageEvent[] = [];
  for await (const e of events) result.push(e);
  return result;
}

describe("createOpenAiCoverImager", () => {
  const signal = () => new AbortController().signal;

  it("streams previews and the final image with usage", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      sse(
        event("image_generation.partial_image", { ...common, b64_json: "AAAA", partial_image_index: 0 }),
        event("image_generation.partial_image", { ...common, b64_json: "BBBB", partial_image_index: 1 }),
        event("image_generation.completed", { ...common, b64_json: "CCCC", usage: { input_tokens: 50, output_tokens: 1768, total_tokens: 1818, input_tokens_details: { image_tokens: 0, text_tokens: 50 } } }),
      ),
    );
    const imager = createOpenAiCoverImager("test-key", { fetch: fetchImpl, maxRetries: 0 });
    expect(await collect(imager.generate(request, { signal: signal() }))).toEqual([
      { type: "start" },
      { type: "partial", index: 0, image: "AAAA", contentType: "image/webp" },
      { type: "partial", index: 1, image: "BBBB", contentType: "image/webp" },
      { type: "done", image: "CCCC", contentType: "image/webp", model: "gpt-image-2.5-flare", quality: "medium", usage: { inputTokens: 50, outputTokens: 1768 } },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-key");
    expect(calls[0]?.body).toEqual(buildCoverImageRequest(request));
  });

  it("throws HTTP errors before the start event (so the route can answer with a status code)", async () => {
    const { fetchImpl } = fakeFetch(
      () => new Response(JSON.stringify({ error: { code: "moderation_blocked", message: "Your request was rejected", type: "image_generation_user_error" } }), { status: 400, headers: { "content-type": "application/json" } }),
    );
    const imager = createOpenAiCoverImager("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const seen: CoverImageEvent[] = [];
    const run = (async () => {
      for await (const e of imager.generate(request, { signal: signal() })) seen.push(e);
    })();
    await expect(run).rejects.toBeInstanceOf(OpenAI.BadRequestError);
    await run.catch((error: unknown) => expect(classifyImagerError(error).status).toBe(400));
    expect(seen).toEqual([]);
  });

  it("turns an error event in the stream into an APIError after the start event", async () => {
    const { fetchImpl } = fakeFetch(() => sse(event("image_generation.partial_image", { ...common, b64_json: "AAAA", partial_image_index: 0 }), `event: error\ndata: ${JSON.stringify({ error: { type: "server_error", message: "oops" } })}\n\n`));
    const imager = createOpenAiCoverImager("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const seen: string[] = [];
    const run = (async () => {
      for await (const e of imager.generate(request, { signal: signal() })) seen.push(e.type);
    })();
    await expect(run).rejects.toBeInstanceOf(OpenAI.APIError);
    expect(seen).toEqual(["start", "partial"]);
  });

  it("aborts the upstream request when the signal fires", async () => {
    const encoder = new TextEncoder();
    let fetchSignal: AbortSignal | null = null;
    const { fetchImpl } = fakeFetch((captured) => {
      fetchSignal = captured.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(event("image_generation.partial_image", { ...common, b64_json: "AAAA", partial_image_index: 0 })));
            captured.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    const imager = createOpenAiCoverImager("test-key", { fetch: fetchImpl, maxRetries: 0 });
    const controller = new AbortController();
    const seen: string[] = [];
    // 和 Anthropic 的 SDK 不同，OpenAI 的 SDK 把中止当成流正常结束（不抛错）：没有 done，路由据 signal 判断是中止
    for await (const e of imager.generate(request, { signal: controller.signal })) {
      seen.push(e.type);
      if (e.type === "partial") controller.abort();
    }
    expect(seen).toEqual(["start", "partial"]);
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("verifies a model with GET /v1/models/{id}", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ id: "gpt-image-2.5-flare", object: "model", created: 1, owned_by: "system" }), { status: 200, headers: { "content-type": "application/json" } }));
    const imager = createOpenAiCoverImager("test-key", { fetch: fetchImpl, maxRetries: 0 });
    await imager.verifyModel("gpt-image-2.5-flare", { signal: signal() });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET https://api.openai.com/v1/models/gpt-image-2.5-flare"]);
  });
});

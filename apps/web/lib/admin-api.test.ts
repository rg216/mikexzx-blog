import type { AdminPost, AdminTranslation } from "@blog/shared";
import { describe, expect, it, vi } from "vitest";
import { AdminApiError, createAdminApi, parseTranslationStreamLine, toAdminApiError } from "./admin-api";

const post: AdminPost = {
  id: 1,
  slug: "hello",
  title: "你好",
  contentMd: "正文",
  excerpt: "正文",
  status: "draft",
  publishedAt: null,
  tags: [],
  images: {},
  locale: "zh",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  sourceLocale: "zh",
  sourceHash: "a".repeat(64),
  translations: [],
};

const translation: AdminTranslation = {
  locale: "en",
  title: "Hello",
  contentMd: "Body",
  excerpt: "Body",
  origin: "human",
  model: null,
  translatedAt: "2026-10-02T00:00:00.000Z",
  sourceHash: "a".repeat(64),
  outdated: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** 假 fetch：记录调用，返回给定的响应。 */
function setup(response: Response | Error) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const onUnauthorized = vi.fn();
  const api = createAdminApi({ fetch, onUnauthorized });
  return { api, fetch, onUnauthorized };
}

async function catchError(promise: Promise<unknown>): Promise<AdminApiError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof AdminApiError)) throw new Error(`expected AdminApiError, got ${String(error)}`);
  return error;
}

describe("toAdminApiError", () => {
  it("keeps code, message and issues from a well-formed error body", () => {
    const error = toAdminApiError(400, {
      error: { code: "validation_error", message: "请求参数无效", issues: [{ path: "slug", message: "格式不对" }] },
    });
    expect(error).toMatchObject({
      status: 400,
      code: "validation_error",
      message: "请求参数无效",
      issues: [{ path: "slug", message: "格式不对" }],
    });
  });

  it("falls back to a code derived from the status when the body is not an API error", () => {
    expect(toAdminApiError(409, "<html>")).toMatchObject({ code: "conflict", issues: [] });
    expect(toAdminApiError(502, undefined)).toMatchObject({ status: 502, code: "internal_error" });
  });
});

describe("createAdminApi", () => {
  it("sends JSON with same-origin credentials to the proxied path", async () => {
    const { api, fetch } = setup(jsonResponse(201, post));
    await api.createPost({ title: "你好", slug: "hello", contentMd: "正文" });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/posts");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ title: "你好", slug: "hello", contentMd: "正文" });
  });

  it("PATCHes only the given fields", async () => {
    const { api, fetch } = setup(jsonResponse(200, post));
    await api.updatePost(1, { status: "published" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/posts/1");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe('{"status":"published"}');
  });

  it("validates responses against the shared schema", async () => {
    const { api } = setup(jsonResponse(200, [{ ...post, status: "archived" }]));
    const error = await catchError(api.listPosts());
    expect(error.code).toBe("bad_response");
  });

  it("returns nothing for 204 on delete", async () => {
    const { api } = setup(new Response(null, { status: 204 }));
    await expect(api.deletePost(1)).resolves.toBeUndefined();
  });

  it("calls onUnauthorized on 401 and still rejects", async () => {
    const { api, onUnauthorized } = setup(jsonResponse(401, { error: { code: "unauthorized", message: "未登录" } }));
    const error = await catchError(api.getPost(1));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(error).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("does not call onUnauthorized for other errors", async () => {
    const { api, onUnauthorized } = setup(jsonResponse(409, { error: { code: "conflict", message: "slug 已被使用" } }));
    const error = await catchError(api.updatePost(1, { slug: "taken" }));
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(error).toMatchObject({ status: 409, code: "conflict", message: "slug 已被使用" });
  });

  it("wraps network failures", async () => {
    const { api } = setup(new TypeError("Failed to fetch"));
    const error = await catchError(api.listPosts());
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});

describe("translations", () => {
  it("GETs a translation by post id and locale", async () => {
    const { api, fetch } = setup(jsonResponse(200, translation));
    await expect(api.getTranslation(1, "en")).resolves.toEqual(translation);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/posts/1/translations/en");
    expect(init?.method).toBe("GET");
  });

  it("PUTs the whole translation with the source hash it was based on", async () => {
    const { api, fetch } = setup(jsonResponse(200, translation));
    const input = { title: "Hello", contentMd: "Body", sourceHash: "a".repeat(64) };
    await api.saveTranslation(1, "ja", input);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/posts/1/translations/ja");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  // API 的 PUT：新建返回 201，替换已有的返回 200——两种都是成功
  it.each([201, 200])("accepts %i from PUT and returns the saved translation", async (status) => {
    const { api } = setup(jsonResponse(status, translation));
    await expect(api.saveTranslation(1, "en", { title: "a", contentMd: "", sourceHash: "a".repeat(64) })).resolves.toEqual(translation);
  });

  it("validates translation responses (unknown locale, missing outdated)", async () => {
    const bad = setup(jsonResponse(200, { ...translation, locale: "fr" }));
    expect((await catchError(bad.api.getTranslation(1, "en"))).code).toBe("bad_response");
    const withoutOutdated: Partial<AdminTranslation> = { ...translation };
    delete withoutOutdated.outdated;
    const missing = setup(jsonResponse(200, withoutOutdated));
    expect((await catchError(missing.api.saveTranslation(1, "en", { title: "a", contentMd: "", sourceHash: "a".repeat(64) }))).code).toBe(
      "bad_response",
    );
  });

  it("DELETEs a translation and resolves on 204", async () => {
    const { api, fetch } = setup(new Response(null, { status: 204 }));
    await expect(api.deleteTranslation(1, "en")).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/posts/1/translations/en");
    expect(init?.method).toBe("DELETE");
  });

  it("surfaces a 400 for the source locale as a validation error", async () => {
    const { api } = setup(jsonResponse(400, { error: { code: "validation_error", message: "不能为原文语言添加译文" } }));
    const error = await catchError(api.saveTranslation(1, "en", { title: "a", contentMd: "", sourceHash: "a".repeat(64) }));
    expect(error).toMatchObject({ status: 400, code: "validation_error", message: "不能为原文语言添加译文" });
  });
});

describe("translation generation", () => {
  const hash = "b".repeat(64);
  const usage = { inputTokens: 1200, outputTokens: 80, cacheReadInputTokens: 0, cacheCreationInputTokens: 1100 };
  const encoder = new TextEncoder();

  /**
   * 假的 NDJSON 响应：把整段文本编码后在给定的字节位置切块，模拟网络把行和多字节字符切开。
   * error 给定时，块发完后以这个错误结束（连接中途断开）；open 时块发完后既不结束也不出错（服务器还没写完）。
   */
  function ndjsonResponse(text: string, cuts: number[] = [], { error, open = false, status = 200 }: { error?: Error; open?: boolean; status?: number } = {}) {
    const bytes = encoder.encode(text);
    const points = [0, ...cuts, bytes.length];
    const chunks = points.slice(1).map((end, i) => bytes.slice(points[i], end));
    let i = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[i++];
        if (chunk) controller.enqueue(chunk);
        else if (error) controller.error(error);
        else if (open) return new Promise<void>(() => {});
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, { status, headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
    return { response, cancelled: () => cancelled };
  }

  const lines = (...events: unknown[]) => events.map((e) => `${JSON.stringify(e)}\n`).join("");
  const done = { type: "done", text: "Hello, 世界", stopReason: "end_turn", model: "claude-sonnet-5-5", usage };

  it("GETs the translation config", async () => {
    const { api, fetch } = setup(jsonResponse(200, { available: true, model: "claude-sonnet-5-5" }));
    await expect(api.getTranslationConfig()).resolves.toEqual({ available: true, model: "claude-sonnet-5-5" });
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/admin/translation/config");
  });

  it("GETs an unavailable config with its reason", async () => {
    const config = { available: false, model: "claude-sonnet-5-5", reason: "rate_limiter_unavailable" };
    const { api } = setup(jsonResponse(200, config));
    await expect(api.getTranslationConfig()).resolves.toEqual(config);
  });

  it("rejects a malformed config", async () => {
    const { api } = setup(jsonResponse(200, { available: "yes", model: "" }));
    expect((await catchError(api.getTranslationConfig())).code).toBe("bad_response");
    // 不能用却不说原因：也不合约定
    const second = setup(jsonResponse(200, { available: false, model: "claude-sonnet-5-5" }));
    expect((await catchError(second.api.getTranslationConfig())).code).toBe("bad_response");
  });

  it("POSTs a title request and validates the result", async () => {
    const { api, fetch } = setup(jsonResponse(200, { title: "Hello", model: "claude-sonnet-5-5", usage }));
    await expect(api.generateTranslationTitle(3, "ja", hash)).resolves.toEqual({ title: "Hello", model: "claude-sonnet-5-5", usage });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/posts/3/translations/ja/generate");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ part: "title", sourceHash: hash });
  });

  it("rejects a malformed title result (empty title, missing usage)", async () => {
    const empty = setup(jsonResponse(200, { title: "", model: "claude-sonnet-5-5", usage }));
    expect((await catchError(empty.api.generateTranslationTitle(1, "en", hash))).code).toBe("bad_response");
    const noUsage = setup(jsonResponse(200, { title: "Hello", model: "claude-sonnet-5-5" }));
    expect((await catchError(noUsage.api.generateTranslationTitle(1, "en", hash))).code).toBe("bad_response");
  });

  it("surfaces the 503 of an unconfigured server and the 409 of a changed source as API errors", async () => {
    const unconfigured = setup(jsonResponse(503, { error: { code: "internal_error", message: "服务器未配置翻译" } }));
    expect(await catchError(unconfigured.api.generateTranslationTitle(1, "en", hash))).toMatchObject({ status: 503, message: "服务器未配置翻译" });
    const conflict = setup(jsonResponse(409, { error: { code: "conflict", message: "原文已更新，请重新加载" } }));
    expect(await catchError(conflict.api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash }))).toMatchObject({ status: 409, code: "conflict" });
  });

  it("streams a segment: body request, NDJSON accept header, deltas in order, resolves with done", async () => {
    const text = lines({ type: "delta", text: "Hello, " }, { type: "delta", text: "世界" }, done);
    const { response } = ndjsonResponse(text);
    const { api, fetch } = setup(response);
    const deltas: string[] = [];
    await expect(api.streamTranslationSegment(3, "en", { index: 2, sourceHash: hash, onDelta: (d) => deltas.push(d) })).resolves.toEqual(done);
    expect(deltas).toEqual(["Hello, ", "世界"]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/posts/3/translations/en/generate");
    expect(JSON.parse(String(init?.body))).toEqual({ part: "body", index: 2, sourceHash: hash });
    expect(new Headers(init?.headers).get("accept")).toBe("application/x-ndjson");
  });

  it("handles chunks split mid-line and mid-character, whatever the cut", async () => {
    const text = lines({ type: "delta", text: "日本語" }, { type: "delta", text: "の文" }, { ...done, text: "日本語の文" });
    const length = encoder.encode(text).length;
    for (let cut = 1; cut < length; cut += 3) {
      const { response } = ndjsonResponse(text, [cut, Math.min(cut + 7, length - 1)]);
      const { api } = setup(response);
      const deltas: string[] = [];
      const result = await api.streamTranslationSegment(1, "ja", { index: 0, sourceHash: hash, onDelta: (d) => deltas.push(d) });
      expect(deltas.join("")).toBe("日本語の文");
      expect(result.text).toBe("日本語の文");
    }
  });

  it("returns refusal and max_tokens as done results for the caller to judge", async () => {
    const { response } = ndjsonResponse(lines({ ...done, text: "", stopReason: "refusal" }));
    const { api } = setup(response);
    await expect(api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash })).resolves.toMatchObject({ stopReason: "refusal" });
  });

  it("reports heartbeats through onPing without treating them as content", async () => {
    const { response } = ndjsonResponse(lines({ type: "ping" }, { type: "ping" }, { type: "delta", text: "Hello, " }, { type: "ping" }, { type: "delta", text: "世界" }, done));
    const { api } = setup(response);
    const seen: string[] = [];
    const result = await api.streamTranslationSegment(1, "en", {
      index: 0,
      sourceHash: hash,
      onPing: () => seen.push("ping"),
      onDelta: (text) => seen.push(text),
    });
    expect(seen).toEqual(["ping", "ping", "Hello, ", "ping", "世界"]);
    expect(result).toEqual(done);
  });

  it("treats a stream of only heartbeats as broken", async () => {
    const { response } = ndjsonResponse(lines({ type: "ping" }, { type: "ping" }));
    const { api } = setup(response);
    expect(await catchError(api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash }))).toMatchObject({ code: "network_error" });
  });

  it("throws the code and message of an error event", async () => {
    const { response } = ndjsonResponse(lines({ type: "delta", text: "partial" }, { type: "error", code: "rate_limited", message: "上游限流" }));
    const { api } = setup(response);
    expect(await catchError(api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash }))).toMatchObject({ code: "rate_limited", message: "上游限流" });
  });

  it("treats a stream that ends without done as broken, not as a short translation", async () => {
    const { response } = ndjsonResponse(lines({ type: "delta", text: "half" }));
    const { api } = setup(response);
    expect(await catchError(api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash }))).toMatchObject({ code: "network_error" });
  });

  it("wraps a connection dropped mid-stream as network_error", async () => {
    const { response } = ndjsonResponse(lines({ type: "delta", text: "half" }), [], { error: new TypeError("network error") });
    const { api } = setup(response);
    const error = await catchError(api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash }));
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it("rejects lines that are not valid events, or not valid UTF-8, as bad_response and stops reading", async () => {
    const invalid = ndjsonResponse(`${lines({ type: "delta", text: "a" })}{"type":"delta"}\n${lines(done)}`, [], { open: true });
    const first = setup(invalid.response);
    expect((await catchError(first.api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash }))).code).toBe("bad_response");
    expect(invalid.cancelled()).toBe(true);

    const garbage = ndjsonResponse("not json\n");
    const second = setup(garbage.response);
    expect((await catchError(second.api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash }))).code).toBe("bad_response");

    const bytes = new Response(new Uint8Array([0x7b, 0xff, 0x7d, 0x0a]));
    const third = setup(bytes);
    expect((await catchError(third.api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash }))).code).toBe("bad_response");
  });

  it("stops reading the stream once done arrives", async () => {
    const stream = ndjsonResponse(lines(done) + lines({ type: "delta", text: "ignored" }), [10], { open: true });
    const { api } = setup(stream.response);
    await expect(api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash })).resolves.toEqual(done);
    expect(stream.cancelled()).toBe(true);
  });

  it("rethrows an abort as AbortError instead of a network error (before and during the stream)", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      init?.signal?.throwIfAborted();
      return new Response("");
    });
    const api = createAdminApi({ fetch, onUnauthorized: vi.fn() });
    controller.abort();
    await expect(api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(api.generateTranslationTitle(1, "en", hash, controller.signal)).rejects.toMatchObject({ name: "AbortError" });

    // 流读到一半中止：真实的 fetch 会让读取以 AbortError 失败
    const midway = new AbortController();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const { response } = ndjsonResponse(lines({ type: "delta", text: "a" }), [], { error: abortError });
    const streaming = setup(response);
    const result = streaming.api.streamTranslationSegment(1, "en", { index: 0, sourceHash: hash, signal: midway.signal, onDelta: () => midway.abort() });
    await expect(result).rejects.toBe(abortError);
  });
});

describe("parseTranslationStreamLine", () => {
  it("parses each event type", () => {
    expect(parseTranslationStreamLine('{"type":"delta","text":"x"}')).toEqual({ type: "delta", text: "x" });
    expect(parseTranslationStreamLine('{"type":"ping"}')).toEqual({ type: "ping" });
    expect(parseTranslationStreamLine('{"type":"error","code":"internal_error","message":"m"}')).toMatchObject({ type: "error" });
  });

  it("rejects non-JSON, unknown types and unknown error codes", () => {
    for (const line of ["{", '{"type":"pong"}', '{"type":"error","code":"teapot","message":"m"}', '{"type":"delta"}']) {
      expect(() => parseTranslationStreamLine(line)).toThrow(AdminApiError);
    }
  });
});

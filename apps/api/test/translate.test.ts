import Anthropic from "@anthropic-ai/sdk";
import {
  adminPostSchema,
  apiErrorSchema,
  splitMarkdownForTranslation,
  tagTranslateResultSchema,
  translationStreamEventSchema,
  translationTitleResultSchema,
  DEFAULT_TRANSLATION_MODEL,
} from "@blog/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type SegmentEvent,
  type TagNameJob,
  type TagNameOutcome,
  type TitleOutcome,
  type TranslationJob,
  type TranslationSegment,
  type Translator,
} from "../src/lib/translator.ts";
import { setupTestApp } from "./helpers.ts";

const TRANSLATION_MODEL = DEFAULT_TRANSLATION_MODEL;

// ---------- 假的翻译器：记录调用，按测试的安排返回结果或抛出 SDK 的错误 ----------

const usage = { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 900, cacheCreationInputTokens: 0 };
const ok = { stopReason: "end_turn", refusalCategory: null, model: TRANSLATION_MODEL, usage, fallback: false };

type TitleImpl = (job: TranslationJob, signal: AbortSignal) => Promise<TitleOutcome>;
type SegmentImpl = (job: TranslationJob, segment: TranslationSegment, signal: AbortSignal) => AsyncIterable<SegmentEvent>;

const defaultTitle: TitleImpl = async () => ({ text: "「Title」", ...ok });
const defaultSegment: SegmentImpl = async function* (_job, segment) {
  yield { type: "start" };
  yield { type: "delta", text: "[ja] " };
  yield { type: "delta", text: segment.text.trim() };
  yield { type: "done", text: `[ja] ${segment.text.trim()}`, ...ok };
};

type TagImpl = (job: TagNameJob) => Promise<TagNameOutcome>;
const defaultTag: TagImpl = async () => ({ text: '{"en":" Front end ","ja":"フロントエンド"}', ...ok });

const calls: { part: "title" | "body"; job: TranslationJob; segment?: TranslationSegment; signal: AbortSignal; model: string }[] = [];
const tagCalls: TagNameJob[] = [];
const tagModels: string[] = [];
let titleImpl = defaultTitle;
let segmentImpl = defaultSegment;
let tagImpl = defaultTag;

const translator: Translator = {
  verifyModel: async () => {},
  translateTitle(job, { signal, model }) {
    calls.push({ part: "title", job, signal, model });
    return titleImpl(job, signal);
  },
  streamSegment(job, segment, { signal, model }) {
    calls.push({ part: "body", job, segment, signal, model });
    return segmentImpl(job, segment, signal);
  },
  translateTagName(job, { model }) {
    tagCalls.push(job);
    tagModels.push(model);
    return tagImpl(job);
  },
};

const apiError = (status: number) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "secret upstream detail" } }, undefined, new Headers());

// 翻译要有 Redis 才启用（rules.translate 是唯一的额度上限，见 createApp）
const { request, requestRaw, createPost, createTag } = setupTestApp({ translator, withRedis: true });

afterEach(() => {
  calls.length = 0;
  tagCalls.length = 0;
  tagModels.length = 0;
  titleImpl = defaultTitle;
  segmentImpl = defaultSegment;
  tagImpl = defaultTag;
  vi.restoreAllMocks();
});

const getPost = async (id: number) => adminPostSchema.parse((await request("GET", `/admin/posts/${id}`)).body);
const generate = (id: number | string, locale: string, body: unknown, options: { auth?: boolean; origin?: string | null } = {}) =>
  request("POST", `/admin/posts/${id}/translations/${locale}/generate`, { body, ...options });
const generateRaw = (id: number, locale: string, body: unknown, signal?: AbortSignal) =>
  requestRaw("POST", `/admin/posts/${id}/translations/${locale}/generate`, { body, ...(signal ? { signal } : {}) });

/** 读完整个 NDJSON 响应，每行用共享 schema 校验 */
async function readEvents(res: Response) {
  const text = await res.text();
  expect(text.endsWith("\n")).toBe(true);
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => translationStreamEventSchema.parse(JSON.parse(line)));
}

async function postWithHash(input: { slug: string; title?: string; contentMd?: string; status?: "draft" | "published" }) {
  const { id } = await createPost(input);
  return { id, hash: (await getPost(id)).sourceHash };
}

describe("GET /admin/translation/config", () => {
  it("tells the editor that translation is available and which model it uses", async () => {
    const res = await request("GET", "/admin/translation/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, model: "claude-sonnet-5-5", tagModel: "claude-sonnet-5-5" });
  });

  it("requires a session", async () => {
    expect((await request("GET", "/admin/translation/config", { auth: false })).status).toBe(401);
  });
});

describe("POST /admin/posts/:id/translations/:locale/generate — checks before calling the model", () => {
  it("requires a session and a same-origin request", async () => {
    const { id, hash } = await postWithHash({ slug: "a" });
    expect((await generate(id, "ja", { part: "title", sourceHash: hash }, { auth: false })).status).toBe(401);
    expect((await generate(id, "ja", { part: "title", sourceHash: hash }, { origin: "https://evil.test" })).status).toBe(403);
    expect((await generate(id, "ja", { part: "title", sourceHash: hash }, { origin: null })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("answers 404 for a missing post", async () => {
    const res = await generate(999, "ja", { part: "title", sourceHash: "0".repeat(64) });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
    expect(calls).toHaveLength(0);
  });

  it("refuses to translate a post into its own language", async () => {
    const { id, hash } = await postWithHash({ slug: "a" });
    const res = await generate(id, "zh", { part: "title", sourceHash: hash });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "validation_error" } });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["an unsupported language", "fr", { part: "title", sourceHash: "0".repeat(64) }],
    ["an unknown part", "ja", { part: "excerpt", sourceHash: "0".repeat(64) }],
    ["a body request without an index", "ja", { part: "body", sourceHash: "0".repeat(64) }],
    ["a negative index", "ja", { part: "body", index: -1, sourceHash: "0".repeat(64) }],
    ["a fractional index", "ja", { part: "body", index: 1.5, sourceHash: "0".repeat(64) }],
    ["a missing source hash", "ja", { part: "title" }],
    ["unknown fields", "ja", { part: "title", sourceHash: "0".repeat(64), effort: "max" }],
    ["a model that is not on the list", "ja", { part: "title", sourceHash: "0".repeat(64), model: "claude-sonnet-5" }],
  ])("rejects %s with 400", async (_name, locale, body) => {
    const { id } = await postWithHash({ slug: "a" });
    const res = await generate(id, locale, body);
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(res.body).error.code).toBe("validation_error");
    expect(calls).toHaveLength(0);
  });

  it("answers 409 when the source changed after the editor loaded it", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "旧的正文。" });
    await request("PATCH", `/admin/posts/${id}`, { body: { contentMd: "新的正文。" } });
    const res = await generate(id, "ja", { part: "body", index: 0, sourceHash: hash });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "conflict", message: "原文已更新，请重新加载后再生成" } });
    expect(calls).toHaveLength(0);
  });

  it("answers 400 for a segment index past the end, naming the number of segments", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "只有一段。" });
    const res = await generate(id, "ja", { part: "body", index: 1, sourceHash: hash });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "validation_error", message: "段号超出范围：正文共 1 段" } });
    // 空正文没有可翻译的段
    const empty = await postWithHash({ slug: "b", contentMd: "" });
    expect((await generate(empty.id, "ja", { part: "body", index: 0, sourceHash: empty.hash })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("which model is called", () => {
  const setModels = (body: unknown) => request("PATCH", "/admin/settings", { body });

  it("uses the models chosen in settings, and reports them in config", async () => {
    expect((await setModels({ translationModel: "claude-opus-5-5", tagTranslationModel: "claude-haiku-5-5" })).status).toBe(200);
    expect((await request("GET", "/admin/translation/config")).body).toEqual({ available: true, model: "claude-opus-5-5", tagModel: "claude-haiku-5-5" });

    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    expect((await generate(id, "ja", { part: "title", sourceHash: hash })).status).toBe(200);
    await readEvents(await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash }));
    expect(calls.map((call) => call.model)).toEqual(["claude-opus-5-5", "claude-opus-5-5"]);

    expect((await request("POST", "/admin/tags/translate", { body: { name: "前端" } })).status).toBe(200);
    expect(tagModels).toEqual(["claude-haiku-5-5"]);
  });

  it("keeps the model the editor started with, even if settings change mid-generation", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    expect((await generate(id, "ja", { part: "title", sourceHash: hash, model: "claude-sonnet-5-5" })).status).toBe(200);
    await setModels({ translationModel: "claude-fable-5-1" });
    await readEvents(await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash, model: "claude-sonnet-5-5" }));
    expect(calls.map((call) => call.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5"]);
  });
});

describe("generating the title", () => {
  it("returns the cleaned title with the serving model and usage, for drafts too", async () => {
    const { id, hash } = await postWithHash({ slug: "a", title: "用 Hono 写 API", contentMd: "正文。", status: "draft" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    titleImpl = async () => ({ text: "「HonoでAPIを書く」\n", ...ok, model: "claude-sonnet-5" });

    const res = await generate(id, "ja", { part: "title", sourceHash: hash });
    expect(res.status).toBe(200);
    expect(translationTitleResultSchema.parse(res.body)).toEqual({ title: "HonoでAPIを書く", model: "claude-sonnet-5", usage });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.job).toEqual({ sourceLocale: "zh", targetLocale: "ja", title: "用 Hono 写 API", contentMd: "正文。" });

    // 用量记一行日志：文章、语言、哪一部分、模型、token
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(line.startsWith("translation ")).toBe(true);
    expect(JSON.parse(line.slice("translation ".length))).toMatchObject({ postId: id, locale: "ja", part: "title", model: "claude-sonnet-5", usage });
  });

  it("fits an overlong serving-model name into the length the save endpoint accepts", async () => {
    const { id, hash } = await postWithHash({ slug: "a" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    titleImpl = async () => ({ text: "Title", ...ok, model: "m".repeat(150) });
    const res = await generate(id, "ja", { part: "title", sourceHash: hash });
    expect(res.status).toBe(200);
    expect(translationTitleResultSchema.parse(res.body).model).toBe(`${"m".repeat(99)}…`);
  });

  it.each([
    ["a refusal", { stopReason: "refusal", refusalCategory: "cyber" }, "模型拒绝翻译这部分内容（类别：cyber）"],
    ["truncation", { stopReason: "max_tokens" }, "译文超出了输出长度上限，被截断"],
    ["an empty title", { text: " \n " }, "模型返回了空的标题"],
  ])("fails with 502 on %s", async (_name, override, message) => {
    const { id, hash } = await postWithHash({ slug: "a" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    titleImpl = async () => ({ text: "Title", ...ok, ...override });
    const res = await generate(id, "ja", { part: "title", sourceHash: hash });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: { code: "internal_error", message } });
  });

  it("maps an invalid API key to 502 without leaking upstream details, and upstream rate limiting to 429", async () => {
    const { id, hash } = await postWithHash({ slug: "a" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    titleImpl = async () => Promise.reject(apiError(401));
    const auth = await generate(id, "ja", { part: "title", sourceHash: hash });
    expect(auth.status).toBe(502);
    expect(apiErrorSchema.parse(auth.body).error.code).toBe("internal_error");
    expect(JSON.stringify(auth.body)).not.toContain("secret upstream detail");
    expect(logged).toHaveBeenCalled();

    titleImpl = async () => Promise.reject(apiError(429));
    const limited = await generate(id, "ja", { part: "title", sourceHash: hash });
    expect(limited.status).toBe(429);
    expect(apiErrorSchema.parse(limited.body).error.code).toBe("rate_limited");
  });
});

describe("generating a body segment (NDJSON stream)", () => {
  const longArticle = () =>
    Array.from({ length: 6 }, (_, i) => `## 第 ${i + 1} 节\n\n${"这是一段很长的正文。".repeat(200)}\n\n\`\`\`sh\necho ${i}\n\`\`\``).join("\n\n");

  it("streams deltas, then done with the text aligned to the source segment's blank lines", async () => {
    const contentMd = longArticle();
    const segments = splitMarkdownForTranslation(contentMd);
    expect(segments.length).toBeGreaterThan(1);
    const { id, hash } = await postWithHash({ slug: "a", contentMd });
    vi.spyOn(console, "info").mockImplementation(() => {});

    const res = await generateRaw(id, "ja", { part: "body", index: 1, sourceHash: hash });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const events = await readEvents(res);

    const source = segments[1] ?? "";
    expect(events).toEqual([
      { type: "delta", text: "[ja] " },
      { type: "delta", text: source.trim() },
      // 模型的输出没有结尾空行；done 的 text 补上原文段的 "\n\n"，各段直接拼接即可
      { type: "done", text: `[ja] ${source.trim()}\n\n`, stopReason: "end_turn", model: TRANSLATION_MODEL, usage },
    ]);
    // 翻译器拿到的是共享切分函数算出的同一段
    expect(calls[0]?.segment).toEqual({ index: 1, total: segments.length, text: source });
    expect(calls[0]?.job.contentMd).toBe(contentMd);
  });

  it("fits an overlong serving-model name in done into the length the save endpoint accepts", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    segmentImpl = async function* () {
      yield { type: "start" };
      yield { type: "done", text: "One.", ...ok, model: ` ${"m".repeat(150)} ` };
    };
    const events = await readEvents(await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash }));
    expect(events).toEqual([{ type: "done", text: "One.", stopReason: "end_turn", model: `${"m".repeat(99)}…`, usage }]);
  });

  it("logs one usage line per segment", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await readEvents(await generateRaw(id, "en", { part: "body", index: 0, sourceHash: hash }));
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]).slice("translation ".length))).toMatchObject({
      postId: id,
      locale: "en",
      part: "body",
      index: 0,
      stopReason: "end_turn",
      usage,
    });
  });

  it.each([
    ["refusal", "cyber"],
    ["max_tokens", null],
  ])("forwards stopReason %s in done (the editor treats it as a failure), with the raw text", async (stopReason, refusalCategory) => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。\n\n第二段。" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    segmentImpl = async function* () {
      yield { type: "start" };
      yield { type: "delta", text: "Partial" };
      yield { type: "done", text: "Partial\n", ...ok, stopReason, refusalCategory };
    };
    const events = await readEvents(await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash }));
    // 失败的输出不做空行对齐（原样，编辑器反正会丢弃）
    expect(events.at(-1)).toEqual({ type: "done", text: "Partial\n", stopReason, model: TRANSLATION_MODEL, usage });
  });

  it.each([
    ["an invalid API key", 401, 502, "internal_error"],
    ["upstream rate limiting", 429, 429, "rate_limited"],
    ["an upstream outage", 529, 502, "internal_error"],
  ])("answers %s before the stream starts with a normal JSON error", async (_name, upstream, status, code) => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    segmentImpl = async function* () {
      yield* [];
      throw apiError(upstream);
    };
    const res = await generate(id, "ja", { part: "body", index: 0, sourceHash: hash });
    expect(res.status).toBe(status);
    expect(apiErrorSchema.parse(res.body).error.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toContain("secret upstream detail");
  });

  it("ends with an error event when the upstream fails after the stream started", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    segmentImpl = async function* () {
      yield { type: "start" };
      yield { type: "delta", text: "Half" };
      throw new Anthropic.APIConnectionError({ message: "socket hang up" });
    };
    const events = await readEvents(await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash }));
    expect(events).toEqual([
      { type: "delta", text: "Half" },
      { type: "error", code: "internal_error", message: "连接翻译服务失败，请稍后再试" },
    ]);
    expect(logged).toHaveBeenCalled();
  });

  it("ends with an error event when the translator stops without a result", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    segmentImpl = async function* () {
      yield { type: "start" };
      yield { type: "delta", text: "Half" };
    };
    const events = await readEvents(await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash }));
    expect(events.at(-1)).toEqual({ type: "error", code: "internal_error", message: "翻译意外中断，请重试" });
  });

  it("turns an empty successful translation into an error event", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。\n\n第二段。" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    segmentImpl = async function* () {
      yield { type: "start" };
      yield { type: "done", text: "\n", ...ok };
    };
    const events = await readEvents(await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash }));
    expect(events).toEqual([{ type: "error", code: "internal_error", message: "模型返回了空的译文" }]);
  });

  it("aborts the upstream call when the browser goes away, and writes nothing more", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let aborted!: () => void;
    const upstreamAborted = new Promise<void>((resolve) => (aborted = resolve));
    segmentImpl = async function* (_job, _segment, signal) {
      yield { type: "start" };
      yield { type: "delta", text: "First" };
      // 模拟模型还在生成：等到被中止为止，然后像 SDK 一样以 APIUserAbortError 结束
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      aborted();
      throw new Anthropic.APIUserAbortError();
    };

    const res = await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash });
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe(`${JSON.stringify({ type: "delta", text: "First" })}\n`);
    await reader.cancel();
    await upstreamAborted;
    expect(calls[0]?.signal.aborted).toBe(true);
    // 中止不是错误：不记错误日志
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logged).not.toHaveBeenCalled();
  });

  it("hands the translator an already-aborted signal when the request was aborted before the handler ran", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    titleImpl = async (_job, signal) => {
      // 像 SDK 一样：signal 已中止就不发请求，直接以 APIUserAbortError 结束
      if (signal.aborted) throw new Anthropic.APIUserAbortError();
      return { text: "Title", ...ok };
    };
    const res = await generateRaw(id, "ja", { part: "title", sourceHash: hash }, AbortSignal.abort());
    // 已中止的 signal 不会再触发 abort 事件：处理函数必须自己检查，否则翻译器拿到的是没中止的 signal，照样发出计费的请求
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(res.status).not.toBe(200);
  });

  it("closes the translator's iterator when the browser goes away, so its cleanup runs", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    let cleanedUp!: () => void;
    const closed = new Promise<void>((resolve) => (cleanedUp = resolve));
    segmentImpl = async function* (_job, _segment, signal) {
      try {
        yield { type: "start" };
        yield { type: "delta", text: "First" };
        // 被中止后不抛错，而是继续给出内容：路由要自己 break，并调用 iterator.return() 让这里的 finally 运行
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        yield { type: "delta", text: "Second" };
        yield { type: "done", text: "First Second", ...ok };
      } finally {
        cleanedUp();
      }
    };
    const res = await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash });
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    await reader.read();
    await reader.cancel();
    await closed;
    expect(calls[0]?.signal.aborted).toBe(true);
  });

  it("aborts the upstream call when the request itself is aborted", async () => {
    const { id, hash } = await postWithHash({ slug: "a", contentMd: "一段。" });
    let aborted!: () => void;
    const upstreamAborted = new Promise<void>((resolve) => (aborted = resolve));
    segmentImpl = async function* (_job, _segment, signal) {
      yield { type: "start" };
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      aborted();
      throw new Anthropic.APIUserAbortError();
    };
    const controller = new AbortController();
    const res = await generateRaw(id, "ja", { part: "body", index: 0, sourceHash: hash }, controller.signal);
    expect(res.status).toBe(200);
    controller.abort();
    await upstreamAborted;
    expect(calls[0]?.signal.aborted).toBe(true);
  });
});

describe("POST /admin/tags/translate", () => {
  const translateTag = (body: unknown, options: { auth?: boolean; origin?: string | null } = {}) => request("POST", "/admin/tags/translate", { body, ...options });

  it("returns a cleaned-up name for every language that needs one", async () => {
    const res = await translateTag({ name: "前端", slug: "frontend" });
    expect(res.status).toBe(200);
    expect(tagTranslateResultSchema.parse(res.body)).toEqual({ translations: { en: "Front end", ja: "フロントエンド" }, model: TRANSLATION_MODEL, usage });
    expect(tagCalls).toEqual([{ sourceLocale: "zh", targetLocales: ["en", "ja"], name: "前端", slug: "frontend", glossary: [] }]);
  });

  it("shows the model the existing fully translated tags, except the one being named", async () => {
    await createTag({ slug: "design", name: "设计", translations: { en: "Design", ja: "デザイン" } });
    await createTag({ slug: "frontend", name: "前端", translations: { en: "Frontend", ja: "フロントエンド" } });
    await translateTag({ name: "前端" });
    expect(tagCalls[0]?.glossary).toEqual([{ name: "设计", translations: { en: "Design", ja: "デザイン" } }]);
    expect(tagCalls[0]?.slug).toBe("");
  });

  it("requires a session and a same-origin request, and validates before calling the model", async () => {
    expect((await translateTag({ name: "前端" }, { auth: false })).status).toBe(401);
    expect((await translateTag({ name: "前端" }, { origin: "https://evil.test" })).status).toBe(403);
    expect((await translateTag({ name: "   " })).status).toBe(400);
    expect((await translateTag({ name: "前端", slug: "Not A Slug" })).status).toBe(400);
    expect(tagCalls).toHaveLength(0);
  });

  it.each([
    ["a refusal", { text: "", ...ok, stopReason: "refusal", refusalCategory: "cyber" }, "模型拒绝翻译这部分内容（类别：cyber）"],
    ["output that is not JSON", { text: "Front end", ...ok }, "模型返回的不是合法的 JSON"],
    ["a missing language", { text: '{"en":"Front end"}', ...ok }, "模型返回的译名不完整或不合规（每种语言 1–50 字）"],
  ])("answers 502 for %s", async (_name, outcome, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tagImpl = async () => outcome;
    const res = await translateTag({ name: "前端" });
    expect(res.status).toBe(502);
    expect(apiErrorSchema.parse(res.body).error.message).toBe(message);
  });

  it("does not leak upstream error details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tagImpl = () => Promise.reject(apiError(529));
    const res = await translateTag({ name: "前端" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("secret upstream detail");
  });
});

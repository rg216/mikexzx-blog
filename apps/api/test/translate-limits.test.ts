import { describe, expect, it, vi } from "vitest";
import { createRateLimiter, rules } from "../src/lib/rate-limit.ts";
import { adminPostSchema } from "@blog/shared";
import { TRANSLATION_MODEL, type Translator } from "../src/lib/translator.ts";
import type { RedisProvider } from "../src/redis.ts";
import { setupTestApp } from "./helpers.ts";

/*
 * 大模型翻译的限流是"每次调用都花钱"的唯一额度上限，所以它不像其他限流那样在 Redis 故障时放行：
 * - Redis 连不上：翻译请求被拒（503），其他写操作照常（fail-open），config 报 available: false（rate_limiter_unavailable）；
 * - 根本没配 Redis：翻译功能不启用（config 报 available: false（not_configured），生成接口 503）。
 * 计数只算通过了校验、真要调用模型的请求：400 / 404 / 409 不占额度。
 */

const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
const calls: string[] = [];
const translator: Translator = {
  model: TRANSLATION_MODEL,
  async translateTitle() {
    calls.push("title");
    return { text: "Title", stopReason: "end_turn", refusalCategory: null, model: TRANSLATION_MODEL, usage, fallback: false };
  },
  async *streamSegment() {
    calls.push("body");
    yield { type: "start" };
  },
  async translateTagName() {
    calls.push("tag");
    return { text: '{"en":"Design","ja":"デザイン"}', stopReason: "end_turn", refusalCategory: null, model: TRANSLATION_MODEL, usage, fallback: false };
  },
};

/** 总是连不上的 Redis */
const brokenRedis: RedisProvider = async () => {
  throw new Error("connect ECONNREFUSED");
};

describe("createRateLimiter when Redis is down", () => {
  it("lets ordinary rules through but refuses fail-closed ones", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const limiter = createRateLimiter(brokenRedis);
    expect(await limiter(rules.adminWrite, "user:1")).toMatchObject({ allowed: true });
    expect(rules.translate.failClosed).toBe(true);
    expect(await limiter(rules.translate, "user:1")).toEqual({ allowed: false, remaining: 0, resetSeconds: 3600, unavailable: true });
    vi.restoreAllMocks();
  });
});

describe("rate limit on LLM translation", () => {
  const app = setupTestApp({ translator, withRedis: true });

  async function postWithHash(contentMd = "一段。") {
    const { id } = await app.createPost({ slug: "a", contentMd });
    return { id, hash: adminPostSchema.parse((await app.request("GET", `/admin/posts/${id}`)).body).sourceHash };
  }
  const generate = (id: number, locale: string, body: unknown) => app.request("POST", `/admin/posts/${id}/translations/${locale}/generate`, { body });

  it("limits generate requests per user per hour, on top of the admin write limit", async () => {
    calls.length = 0;
    const { id, hash } = await postWithHash();
    vi.spyOn(console, "info").mockImplementation(() => {});

    const first = await generate(id, "en", { part: "title", sourceHash: hash });
    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-policy")).toBe('"translate";q=120;w=3600');
    expect(first.headers.get("ratelimit")).toMatch(/^"translate";r=119;t=\d+$/);

    // 用掉这一小时剩下的额度（直接调限流器，不必发 119 个请求、也不受每分钟的写操作限流影响）
    if (!app.redis) throw new Error("needs redis");
    const limiter = createRateLimiter(app.redis);
    for (let i = 1; i < rules.translate.limit; i++) await limiter(rules.translate, "user:1");
    const limited = await generate(id, "en", { part: "title", sourceHash: hash });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("ratelimit-policy")).toBe('"translate";q=120;w=3600');
    expect(limited.body).toMatchObject({ error: { code: "rate_limited" } });
    expect(calls).toEqual(["title"]);
    vi.restoreAllMocks();
  });

  it("does not count requests rejected by validation (400 / 404 / 409) against the paid-call budget", async () => {
    calls.length = 0;
    const { id, hash } = await postWithHash();
    vi.spyOn(console, "info").mockImplementation(() => {});
    await app.request("PATCH", `/admin/posts/${id}`, { body: { title: "改过的标题" } });
    const current = adminPostSchema.parse((await app.request("GET", `/admin/posts/${id}`)).body).sourceHash;

    const rejected = [
      await generate(id, "zh", { part: "title", sourceHash: current }), // 原文语言
      await generate(id, "fr", { part: "title", sourceHash: current }), // 不支持的语言
      await generate(id, "en", { part: "excerpt", sourceHash: current }), // 请求体不对
      await generate(999, "en", { part: "title", sourceHash: current }), // 文章不存在
      await generate(id, "en", { part: "title", sourceHash: hash }), // 原文已更新
      await generate(id, "en", { part: "body", index: 5, sourceHash: current }), // 段号超出范围
    ];
    expect(rejected.map((res) => res.status)).toEqual([400, 400, 400, 404, 409, 400]);
    for (const res of rejected) expect(res.headers.get("ratelimit-policy")).not.toContain("translate");
    expect(calls).toEqual([]);

    // 第一个真正调用模型的请求才用掉第一次额度
    const ok = await generate(id, "en", { part: "title", sourceHash: current });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("ratelimit")).toMatch(/^"translate";r=119;/);
    vi.restoreAllMocks();
  });
});

describe("LLM translation while Redis is down", () => {
  const app = setupTestApp({ translator, redisProvider: brokenRedis });

  it("reports in config that generation cannot run right now, and why", async () => {
    expect((await app.request("GET", "/admin/translation/config")).body).toEqual({
      available: false,
      model: TRANSLATION_MODEL,
      reason: "rate_limiter_unavailable",
    });
  });

  it("refuses generate requests with 503 without calling the model, while other admin writes still work", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    calls.length = 0;
    const { id } = await app.createPost({ slug: "a" });
    const post = await app.request("GET", `/admin/posts/${id}`);
    const sourceHash = (post.body as { sourceHash: string }).sourceHash;

    const res = await app.request("POST", `/admin/posts/${id}/translations/en/generate`, { body: { part: "title", sourceHash } });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: "internal_error", message: "限流服务暂时不可用，这个功能先停用，请稍后再试" } });
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('refusing "translate"'), expect.anything());

    // 通用的写操作限流仍然放行：Redis 故障不该让作者写不了文章
    expect((await app.request("PATCH", `/admin/posts/${id}`, { body: { title: "新标题" } })).status).toBe(200);
    vi.restoreAllMocks();
  });
});

describe("LLM translation without Redis configured", () => {
  const app = setupTestApp({ translator });

  it("stays disabled even though a translator (ANTHROPIC_API_KEY) is configured", async () => {
    calls.length = 0;
    expect((await app.request("GET", "/admin/translation/config")).body).toEqual({ available: false, model: TRANSLATION_MODEL, reason: "not_configured" });
    const { id } = await app.createPost({ slug: "a" });
    const res = await app.request("POST", `/admin/posts/${id}/translations/en/generate`, { body: { part: "title", sourceHash: "0".repeat(64) } });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: { code: "internal_error", message: expect.stringContaining("REDIS_URL") } });
    expect(calls).toEqual([]);
  });
});

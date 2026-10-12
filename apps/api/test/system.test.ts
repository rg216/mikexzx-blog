import Anthropic from "@anthropic-ai/sdk";
import { apiErrorSchema, defaultSiteSettings, siteSettingsSchema, systemStatusSchema, type StatusCheckId } from "@blog/shared";
import { describe, expect, it, vi } from "vitest";
import { jobRuns, settings } from "../src/db/schema.ts";
import type { Translator } from "../src/lib/translator.ts";
import type { RedisProvider } from "../src/redis.ts";
import { migrationState } from "../src/services/status.ts";
import { CRON_SECRET, setupTestApp } from "./helpers.ts";

/*
 * 后台的运行时设置（GET / PATCH /admin/settings）和状态页（GET /admin/status）。
 */

const verified: string[] = [];
let verifyImpl: (model: string) => Promise<void> = async () => {};
const translator: Translator = {
  verifyModel: (model) => {
    verified.push(model);
    return verifyImpl(model);
  },
  translateTitle: () => Promise.reject(new Error("not used")),
  translateTagName: () => Promise.reject(new Error("not used")),
  streamSegment: () => {
    throw new Error("not used");
  },
};

const brokenRedis: RedisProvider = () => Promise.reject(new Error("ECONNREFUSED"));
const cron = { auth: false, headers: { authorization: `Bearer ${CRON_SECRET}` } } as const;

describe("GET / PATCH /admin/settings", () => {
  const { request, db } = setupTestApp();

  it("starts from the defaults (Sonnet 5.5 for both, as before the setting existed)", async () => {
    const res = await request("GET", "/admin/settings");
    expect(res.status).toBe(200);
    expect(siteSettingsSchema.parse(res.body)).toEqual(defaultSiteSettings);
    expect(defaultSiteSettings).toEqual({ translationModel: "claude-sonnet-5-5", tagTranslationModel: "claude-sonnet-5-5" });
  });

  it("updates only the keys given and returns the whole settings", async () => {
    const res = await request("PATCH", "/admin/settings", { body: { tagTranslationModel: "claude-haiku-5-5" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ translationModel: "claude-sonnet-5-5", tagTranslationModel: "claude-haiku-5-5" });
    await request("PATCH", "/admin/settings", { body: { translationModel: "claude-opus-5-5" } });
    expect((await request("GET", "/admin/settings")).body).toEqual({ translationModel: "claude-opus-5-5", tagTranslationModel: "claude-haiku-5-5" });
  });

  it.each([
    ["a model that is not on the list", { translationModel: "claude-sonnet-5" }],
    ["an unknown key", { theme: "dark" }],
    ["nothing to update", {}],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await request("PATCH", "/admin/settings", { body });
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(res.body).error.code).toBe("validation_error");
  });

  it("falls back to the default for a stored value it no longer accepts, and ignores unknown keys", async () => {
    await db.insert(settings).values([
      { key: "translationModel", value: "claude-sonnet-4-5" },
      { key: "tagTranslationModel", value: "claude-haiku-5-5" },
      { key: "removedSetting", value: { a: 1 } },
    ]);
    expect((await request("GET", "/admin/settings")).body).toEqual({ translationModel: "claude-sonnet-5-5", tagTranslationModel: "claude-haiku-5-5" });
  });

  it("requires a session and a same-origin request", async () => {
    expect((await request("GET", "/admin/settings", { auth: false })).status).toBe(401);
    expect((await request("PATCH", "/admin/settings", { auth: false, body: { translationModel: "claude-opus-5-5" } })).status).toBe(401);
    expect((await request("PATCH", "/admin/settings", { origin: "https://evil.test", body: { translationModel: "claude-opus-5-5" } })).status).toBe(403);
  });
});

describe("GET /admin/status — everything configured", () => {
  const probes: string[] = [];
  const { request, db } = setupTestApp({
    withRedis: true,
    withStorage: true,
    translator,
    revalidateProbe: async () => {
      probes.push("probe");
      return { state: "ok", summary: "前端接受通知" };
    },
  });
  const status = async () => {
    const res = await request("GET", "/admin/status");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    return systemStatusSchema.parse(res.body);
  };
  const check = (body: Awaited<ReturnType<typeof status>>, id: StatusCheckId) => body.checks.find((c) => c.id === id);

  it("reports every dependency as working, without leaking any configuration value", async () => {
    verified.length = 0;
    verifyImpl = async () => {};
    await request("PATCH", "/admin/settings", { body: { tagTranslationModel: "claude-haiku-5-5" } });
    const body = await status();
    expect(body.checks.map((c) => [c.id, c.state])).toEqual([
      ["database", "ok"],
      ["migrations", "ok"],
      ["redis", "ok"],
      ["storage", "ok"],
      ["anthropic", "ok"],
      ["github", "ok"],
      ["revalidate", "ok"],
      ["cron", "ok"],
    ]);
    expect(check(body, "migrations")?.summary).toMatch(/^已执行到 \d{4}_/);
    expect(check(body, "anthropic")?.summary).toBe("密钥有效，模型可用：文章用 Sonnet 5.5，标签用 Haiku 5.5");
    // 只检查设置里选中的模型，每个一次
    expect(verified).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(probes).toHaveLength(1);
    expect(body.version).toBeNull();
    // 网络检查带耗时，只看配置的不带
    expect(check(body, "database")?.latencyMs).toEqual(expect.any(Number));
    expect(check(body, "github")?.latencyMs).toBeNull();
    const text = JSON.stringify(body);
    expect(text).not.toContain(CRON_SECRET);
    expect(text).not.toContain(process.env.TEST_DATABASE_URL ?? "postgres://");
  });

  it("explains an invalid API key, naming the model it was checking", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    verifyImpl = async () => {
      throw Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "secret upstream detail" } }, undefined, new Headers());
    };
    const anthropic = check(await status(), "anthropic");
    expect(anthropic).toMatchObject({ state: "error", summary: "Sonnet 5.5：翻译服务的凭证无效或没有权限（详见服务器日志）" });
    expect(anthropic?.summary).not.toContain("secret upstream detail");
    verifyImpl = async () => {};
    error.mockRestore();
  });

  it("shows each cron job's last run: never run, succeeded, or failed while keeping the last success", async () => {
    let body = await status();
    expect(body.jobs).toEqual([
      { name: "views-flush", state: "off", lastRunAt: null, lastSuccessAt: null, detail: null },
      { name: "images-cleanup", state: "off", lastRunAt: null, lastSuccessAt: null, detail: null },
    ]);

    expect((await request("GET", "/internal/images/cleanup", cron)).status).toBe(200);
    expect((await request("GET", "/internal/views/flush", cron)).status).toBe(200);
    body = await status();
    const cleanup = body.jobs.find((job) => job.name === "images-cleanup");
    expect(cleanup).toMatchObject({ state: "ok", detail: JSON.stringify({ deleted: 0, dimensionsFilled: 0 }) });
    expect(cleanup?.lastSuccessAt).toBe(cleanup?.lastRunAt);
    expect(body.jobs.find((job) => job.name === "views-flush")?.state).toBe("ok");
  });

  it("warns when a job has not succeeded for more than a day, and marks a failed last run as an error", async () => {
    const longAgo = new Date(Date.now() - 30 * 60 * 60 * 1000);
    await db.insert(jobRuns).values([
      { name: "views-flush", startedAt: longAgo, finishedAt: longAgo, ok: true, detail: {}, lastSuccessAt: longAgo },
      { name: "images-cleanup", startedAt: new Date(), finishedAt: new Date(), ok: false, detail: { error: "R2 503" }, lastSuccessAt: longAgo },
    ]);
    const body = await status();
    expect(body.jobs.map((job) => [job.name, job.state])).toEqual([
      ["views-flush", "warning"],
      ["images-cleanup", "error"],
    ]);
    expect(body.jobs[1]).toMatchObject({ detail: JSON.stringify({ error: "R2 503" }), lastSuccessAt: longAgo.toISOString() });
  });

  it("requires a session", async () => {
    expect((await request("GET", "/admin/status", { auth: false })).status).toBe(401);
  });
});

describe("GET /admin/status — nothing optional configured", () => {
  const bare = setupTestApp();
  it("marks unconfigured dependencies as off and says what is switched off", async () => {
    const body = systemStatusSchema.parse((await bare.request("GET", "/admin/status")).body);
    const states = Object.fromEntries(body.checks.map((c) => [c.id, c.state]));
    expect(states).toEqual({ database: "ok", migrations: "ok", redis: "off", storage: "off", anthropic: "off", github: "ok", revalidate: "off", cron: "ok" });
    expect(body.checks.find((c) => c.id === "anthropic")?.summary).toContain("ANTHROPIC_API_KEY");
    expect(body.checks.find((c) => c.id === "redis")?.latencyMs).toBeNull();
  });
});

describe("GET /admin/status — Redis down, translator without Redis, slow probe", () => {
  const broken = setupTestApp({
    redisProvider: brokenRedis,
    translator,
    statusTimeoutMs: 50,
    revalidateProbe: () => new Promise(() => {}),
  });

  it("reports the failure of each check on its own line, timing out the ones that hang", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    verifyImpl = async () => {};
    const body = systemStatusSchema.parse((await broken.request("GET", "/admin/status")).body);
    const byId = Object.fromEntries(body.checks.map((c) => [c.id, c]));
    expect(byId.redis).toMatchObject({ state: "error", summary: "检查失败：ECONNREFUSED" });
    expect(byId.revalidate).toMatchObject({ state: "error", summary: "检查超时（0.05 秒没有回应）" });
    expect(byId.database?.state).toBe("ok");
    expect(byId.anthropic?.state).toBe("ok");
    error.mockRestore();
  });
});

describe("GET /admin/status — API key without Redis", () => {
  const noRedis = setupTestApp({ translator });
  it("warns that translation stays off because its rate limit needs Redis", async () => {
    verifyImpl = async () => {};
    const body = systemStatusSchema.parse((await noRedis.request("GET", "/admin/status")).body);
    expect(body.checks.find((c) => c.id === "anthropic")).toMatchObject({ state: "warning", summary: expect.stringContaining("没有 REDIS_URL") });
  });
});

describe("migrationState", () => {
  const entries = [
    { tag: "0010_a", when: 100 },
    { tag: "0011_b", when: 200 },
    { tag: "0012_c", when: 300 },
  ];
  it("is ok when the last applied migration is the newest, and lists the ones not run yet otherwise", () => {
    expect(migrationState(entries, 300)).toEqual({ state: "ok", summary: "已执行到 0012_c" });
    expect(migrationState(entries, 100)).toEqual({ state: "warning", summary: "有 2 个迁移没有执行：0011_b、0012_c" });
    expect(migrationState(entries, 0).summary).toContain("3 个");
  });
});

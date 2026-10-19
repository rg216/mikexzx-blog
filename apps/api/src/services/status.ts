import {
  type JobStatus,
  jobNames,
  STALE_JOB_HOURS,
  type StatusCheck,
  type StatusCheckId,
  type StatusState,
  type SystemStatus,
  coverImageModelInfo,
  translationModelInfo,
} from "@blog/shared";
import { sql } from "drizzle-orm";
import journal from "../../drizzle/meta/_journal.json" with { type: "json" };
import type { Db } from "../db/client.ts";
import type { RevalidateProbeResult } from "../lib/revalidate.ts";
import { classifyImagerError, type CoverImager } from "../lib/cover-imager.ts";
import { classifyTranslatorError, type Translator } from "../lib/translator.ts";
import type { RedisProvider } from "../redis.ts";
import type { ObjectStorage } from "../storage.ts";
import { listJobRuns } from "./jobs.ts";
import { getSettings } from "./settings.ts";

/*
 * 后台状态页（GET /admin/status）：逐项检查依赖，只报告"配了没有、能不能用"，绝不返回配置值。
 * 每项检查互相独立、各有超时：一项挂住或抛错只影响它自己那一行，页面总能打开。
 */

export type StatusDeps = {
  db: Db;
  version: string | null;
  redis: RedisProvider | null;
  storage: ObjectStorage | null;
  githubConfigured: boolean;
  /** 配了 ANTHROPIC_API_KEY 就有（不管 Redis 在不在：状态页要分别说明两者） */
  translator: Translator | null;
  /** 配了 OPENAI_API_KEY 就有（同样不管 Redis） */
  coverImager: CoverImager | null;
  /** null：API 没有设置 REVALIDATE_SECRET */
  probeRevalidate: (() => Promise<RevalidateProbeResult>) | null;
  cronConfigured: boolean;
  /** 每项检查的超时（毫秒），测试里调短 */
  timeoutMs?: number;
};

type CheckResult = { state: StatusState; summary: string };

const DEFAULT_TIMEOUT_MS = 5000;

/** 跑一项检查：计时、超时、把意外的异常变成 error，而不是让整个状态页 500 */
async function runCheck(id: StatusCheckId, timeoutMs: number, check: (signal: AbortSignal) => Promise<CheckResult>, timed = true): Promise<StatusCheck> {
  const started = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ state: "error", summary: `检查超时（${timeoutMs / 1000} 秒没有回应）` });
    }, timeoutMs);
  });
  let result: CheckResult;
  try {
    result = await Promise.race([check(controller.signal), timeout]);
  } catch (error) {
    console.error(`status check ${id} failed`, error);
    result = { state: "error", summary: error instanceof Error ? `检查失败：${error.message}` : "检查失败" };
  } finally {
    clearTimeout(timer);
  }
  return { id, ...result, latencyMs: timed ? Math.round(performance.now() - started) : null };
}

const off = (summary: string): CheckResult => ({ state: "off", summary });

async function checkDatabase(db: Db): Promise<CheckResult> {
  await db.execute(sql`select 1`);
  return { state: "ok", summary: "连接正常" };
}

/**
 * 代码里的迁移（打包进来的 drizzle/meta/_journal.json）有没有都在这个库里执行过。
 * 和 Drizzle 的迁移器同一个判断方式：按每个迁移的 when 和库里最后执行的那个比较。
 * 先部署了新 API、忘了在 Neon 上执行迁移时，这里会直接指出来。
 */
async function checkMigrations(db: Db): Promise<CheckResult> {
  const expected = journal.entries;
  let lastApplied = 0;
  try {
    const result = await db.execute<{ created_at: string | number | null }>(sql`select max(created_at) as created_at from drizzle.__drizzle_migrations`);
    lastApplied = Number(result.rows[0]?.created_at ?? 0);
  } catch {
    return { state: "error", summary: "读不到迁移记录（drizzle.__drizzle_migrations），这个库可能从没执行过迁移" };
  }
  return migrationState(expected, lastApplied);
}

/** 按迁移的 when 和库里最后执行的那个（created_at）比较，得出状态 */
export function migrationState(entries: readonly { tag: string; when: number }[], lastApplied: number): CheckResult {
  const pending = entries.filter((entry) => entry.when > lastApplied);
  if (pending.length === 0) return { state: "ok", summary: `已执行到 ${entries.at(-1)?.tag ?? "（无）"}` };
  return { state: "warning", summary: `有 ${pending.length} 个迁移没有执行：${pending.map((entry) => entry.tag).join("、")}` };
}

async function checkRedis(redis: RedisProvider | null): Promise<CheckResult> {
  if (!redis) return off("没有设置 REDIS_URL：不限流、不计阅读数，翻译功能关闭");
  await (await redis()).ping();
  return { state: "ok", summary: "PING 正常" };
}

/** HEAD 一个不存在的对象：凭证对就是 404（返回 null），凭证错是 403（抛出） */
async function checkStorage(storage: ObjectStorage | null): Promise<CheckResult> {
  if (!storage) return off("没有设置 S3_*：后台不能上传图片");
  await storage.head("status-probe/does-not-exist");
  return { state: "ok", summary: "存储桶可以访问" };
}

async function checkAnthropic(deps: StatusDeps, signal: AbortSignal): Promise<CheckResult> {
  if (!deps.translator) return off("没有设置 ANTHROPIC_API_KEY：翻译、写头图描述的功能关闭");
  const settings = await getSettings(deps.db);
  const models = [...new Set([settings.translationModel, settings.tagTranslationModel, settings.coverPromptModel])];
  for (const model of models) {
    try {
      await deps.translator.verifyModel(model, { signal });
    } catch (error) {
      const failure = classifyTranslatorError(error);
      console.error(`status check: model ${model} not available`, error);
      return { state: "error", summary: `${translationModelInfo(model).name}：${failure.message}` };
    }
  }
  const name = (model: typeof settings.translationModel) => translationModelInfo(model).name;
  const names = `文章用 ${name(settings.translationModel)}，标签用 ${name(settings.tagTranslationModel)}，头图描述用 ${name(settings.coverPromptModel)}`;
  if (!deps.redis) return { state: "warning", summary: `密钥有效（${names}），但没有 REDIS_URL：翻译的限流需要 Redis，功能关闭` };
  return { state: "ok", summary: `密钥有效，模型可用：${names}` };
}

async function checkOpenAi(deps: StatusDeps, signal: AbortSignal): Promise<CheckResult> {
  if (!deps.coverImager) return off("没有设置 OPENAI_API_KEY：生成头图时不能出图");
  const { coverImageModel: model } = await getSettings(deps.db);
  const name = coverImageModelInfo(model).name;
  try {
    await deps.coverImager.verifyModel(model, { signal });
  } catch (error) {
    console.error(`status check: image model ${model} not available`, error);
    return { state: "error", summary: `${name}：${classifyImagerError(error).message}` };
  }
  if (!deps.redis) return { state: "warning", summary: `密钥有效（${name}），但没有 REDIS_URL：出图的限流需要 Redis，功能关闭` };
  // 模型列表里有它不代表一定能出图：GPT Image 可能还要求组织验证，那要等第一次出图才知道
  return { state: "ok", summary: `密钥有效，${name} 可用` };
}

async function checkRevalidate(probe: StatusDeps["probeRevalidate"]): Promise<CheckResult> {
  if (!probe) return off("API 没有设置 REVALIDATE_SECRET：改文章后前台要等一小时的定时刷新");
  return probe();
}

/** 只检查配置：定时任务实际跑得怎么样看下面的任务列表 */
function checkCron(configured: boolean): CheckResult {
  return configured ? { state: "ok", summary: "已设置 CRON_SECRET" } : off("没有设置 CRON_SECRET：定时任务接口不可用（阅读数不入库、不清理未确认的图片）");
}

async function jobStatuses(db: Db, now: Date): Promise<JobStatus[]> {
  let rows: Awaited<ReturnType<typeof listJobRuns>>;
  try {
    rows = await listJobRuns(db);
  } catch (error) {
    console.error("status: could not read job runs", error);
    return jobNames.map((name) => ({ name, state: "error", lastRunAt: null, lastSuccessAt: null, detail: "读不到运行记录（迁移执行了吗？）" }));
  }
  const staleBefore = now.getTime() - STALE_JOB_HOURS * 60 * 60 * 1000;
  return jobNames.map((name) => {
    const row = rows.find((r) => r.name === name);
    if (!row) return { name, state: "off", lastRunAt: null, lastSuccessAt: null, detail: null };
    // 最近一次失败是 error；成功过、但已经太久没成功（漏跑）是 warning
    const stale = !row.lastSuccessAt || row.lastSuccessAt.getTime() < staleBefore;
    const state: StatusState = !row.ok ? "error" : stale ? "warning" : "ok";
    return {
      name,
      state,
      lastRunAt: row.finishedAt.toISOString(),
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      detail: JSON.stringify(row.detail),
    };
  });
}

export async function systemStatus(deps: StatusDeps): Promise<SystemStatus> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = new Date();
  const [checks, jobs] = await Promise.all([
    Promise.all([
      runCheck("database", timeoutMs, () => checkDatabase(deps.db)),
      runCheck("migrations", timeoutMs, () => checkMigrations(deps.db), false),
      runCheck("redis", timeoutMs, () => checkRedis(deps.redis), Boolean(deps.redis)),
      runCheck("storage", timeoutMs, () => checkStorage(deps.storage), Boolean(deps.storage)),
      runCheck("anthropic", timeoutMs, (signal) => checkAnthropic(deps, signal), Boolean(deps.translator)),
      runCheck("openai", timeoutMs, (signal) => checkOpenAi(deps, signal), Boolean(deps.coverImager)),
      runCheck("github", timeoutMs, async () => (deps.githubConfigured ? { state: "ok", summary: "已配置（不联网检查）" } : off("没有设置 GitHub App：评论区只读")), false),
      runCheck("revalidate", timeoutMs, () => checkRevalidate(deps.probeRevalidate), Boolean(deps.probeRevalidate)),
      runCheck("cron", timeoutMs, async () => checkCron(deps.cronConfigured), false),
    ]),
    jobStatuses(deps.db, now),
  ]);
  return { version: deps.version, checkedAt: now.toISOString(), checks, jobs };
}

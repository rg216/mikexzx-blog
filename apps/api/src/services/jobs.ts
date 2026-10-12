import { type JobName } from "@blog/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { jobRuns } from "../db/schema.ts";

/**
 * 运行一个定时任务并记下结果（job_runs，每个任务一行，覆盖写），状态页据此显示最近一次运行。
 * 失败时记下错误说明后原样抛出：路由照常返回 500，平台的日志里有完整的错误。
 * 记录本身失败（比如迁移还没执行、表不存在）不影响任务的结果：记一条日志就算了。
 */
export async function recordJobRun<T>(db: Db, name: JobName, run: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await run();
    await save(db, { name, startedAt, ok: true, detail: result });
    return result;
  } catch (error) {
    await save(db, { name, startedAt, ok: false, detail: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

async function save(db: Db, run: { name: JobName; startedAt: Date; ok: boolean; detail: unknown }) {
  const finishedAt = new Date();
  try {
    await db
      .insert(jobRuns)
      .values({ ...run, finishedAt, lastSuccessAt: run.ok ? finishedAt : null })
      .onConflictDoUpdate({
        target: jobRuns.name,
        set: {
          startedAt: run.startedAt,
          finishedAt,
          ok: run.ok,
          detail: run.detail,
          // 失败时保留上一次成功的时间
          lastSuccessAt: run.ok ? finishedAt : sql`${jobRuns.lastSuccessAt}`,
        },
      });
  } catch (error) {
    console.error(`could not record job run ${run.name}`, error);
  }
}

export async function listJobRuns(db: Db) {
  return db.select().from(jobRuns);
}

import { z } from "zod";

/*
 * 后台的状态页（GET /admin/status）：各项依赖配好了没有、现在连不连得上，定时任务最近一次跑得怎么样。
 * 只报告状态，绝不返回任何配置值（密钥、连接地址）。
 */

/**
 * 每项检查的结果：
 *   ok       配好了、能用
 *   warning  能用但有问题（比如有迁移没执行、定时任务超过一天没成功）
 *   error    配了但用不了（连不上、凭证无效）
 *   off      没有配置：这些依赖都是可选的，没配只是相应功能关闭（比如没有 GitHub 登录时评论区只读）
 */
export const statusStates = ["ok", "warning", "error", "off"] as const;
export const statusStateSchema = z.enum(statusStates);
export type StatusState = z.infer<typeof statusStateSchema>;

export const statusCheckIds = ["database", "migrations", "redis", "storage", "anthropic", "github", "revalidate", "cron"] as const;
export type StatusCheckId = (typeof statusCheckIds)[number];

export const statusCheckSchema = z.object({
  id: z.enum(statusCheckIds),
  state: statusStateSchema,
  /** 给管理员看的一句话说明（中文，后台固定中文） */
  summary: z.string(),
  /** 这次检查花了多久（毫秒）；没有发网络请求的检查为 null */
  latencyMs: z.number().nonnegative().nullable(),
});
export type StatusCheck = z.infer<typeof statusCheckSchema>;

/** 定时任务（apps/api/vercel.json 的 crons）。每天跑一次，超过 STALE_JOB_HOURS 没成功就提醒 */
export const jobNames = ["views-flush", "images-cleanup"] as const;
export const jobNameSchema = z.enum(jobNames);
export type JobName = z.infer<typeof jobNameSchema>;

/** 每天一次的任务，留两小时余量：超过这么久没有成功过就是漏跑或一直失败 */
export const STALE_JOB_HOURS = 26;

export const jobStatusSchema = z.object({
  name: jobNameSchema,
  state: statusStateSchema,
  /** 最近一次运行的结束时间；从没运行过为 null */
  lastRunAt: z.iso.datetime({ offset: true }).nullable(),
  /** 最近一次成功的时间 */
  lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  /** 最近一次的结果摘要（成功时是任务的返回值，失败时是错误说明），JSON 文本 */
  detail: z.string().nullable(),
});
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const systemStatusSchema = z.object({
  /** 线上 API 的版本（部署的提交号）；本地为 null */
  version: z.string().nullable(),
  checkedAt: z.iso.datetime({ offset: true }),
  checks: z.array(statusCheckSchema),
  jobs: z.array(jobStatusSchema),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

/** 一组状态里最严重的那个（error > warning > ok > off），页面顶部的总体状态用它 */
export function worstState(states: readonly StatusState[]): StatusState {
  const order: StatusState[] = ["error", "warning", "ok", "off"];
  return order.find((state) => states.includes(state)) ?? "off";
}

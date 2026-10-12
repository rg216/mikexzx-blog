import { siteSettingsUpdateSchema } from "@blog/shared";
import { Hono } from "hono";
import type { Db } from "../db/client.ts";
import { validate } from "../lib/validate.ts";
import type { AuthEnv } from "../middleware/auth.ts";
import { getSettings, updateSettings } from "../services/settings.ts";
import { type StatusDeps, systemStatus } from "../services/status.ts";

/*
 * 后台"设置"里的运行时设置和状态页（挂在 /admin 下：登录、同源校验、写操作限流由外层负责）。
 *   GET   /settings  → 当前设置（缺的键是默认值）
 *   PATCH /settings  → 改给出的键，返回完整设置
 *   GET   /status    → 各项依赖和定时任务的状态（只报告状态，不返回任何配置值）
 */
export function adminSystemRoutes(db: Db, status: Omit<StatusDeps, "db">) {
  return new Hono<AuthEnv>()
    .get("/settings", async (c) => c.json(await getSettings(db)))
    .patch("/settings", validate("json", siteSettingsUpdateSchema), async (c) => c.json(await updateSettings(db, c.req.valid("json"))))
    .get("/status", async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await systemStatus({ db, ...status }));
    });
}

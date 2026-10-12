import { settingsFromRows, type SiteSettings, type SiteSettingsUpdate } from "@blog/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { settings } from "../db/schema.ts";

/** 当前的设置：表里没有、或值不合法的键用默认值（settingsFromRows）。每次请求读一次（一张几行的小表），改了立即生效，不用缓存 */
export async function getSettings(db: Db): Promise<SiteSettings> {
  return settingsFromRows(await db.select({ key: settings.key, value: settings.value }).from(settings));
}

/** 改给出的键（upsert），返回改完的完整设置 */
export async function updateSettings(db: Db, update: SiteSettingsUpdate): Promise<SiteSettings> {
  const rows = Object.entries(update)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value }));
  await db
    .insert(settings)
    .values(rows)
    .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value`, updatedAt: new Date() } });
  return getSettings(db);
}

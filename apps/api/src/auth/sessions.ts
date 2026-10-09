import { eq, lt, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import { randomToken, sha256Hex } from "./tokens.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 闲置超过 7 天失效 */
export const SESSION_IDLE_MS = 7 * DAY;
/** 无论是否活跃，最长 30 天必须重新登录 */
export const SESSION_MAX_MS = 30 * DAY;
/** "最近活跃时间"最多每小时写一次，避免每个请求都写库 */
const TOUCH_INTERVAL_MS = HOUR;

export type SessionUser = { id: number; displayName: string };
export type ValidSession = { id: string; user: SessionUser; expiresAt: Date };

/** 创建 session，返回给 cookie 用的明文 token（数据库里只存它的哈希）。 */
export async function createSession(
  db: Db,
  userId: number,
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_MS);
  await db.insert(sessions).values({
    id: sha256Hex(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    userAgent: userAgent?.slice(0, 500) ?? null,
  });
  return { token, expiresAt };
}

/** 校验 cookie 里的 token：不存在、过期、闲置过久都返回 null。顺便删除这一条已失效的记录。 */
export async function validateSession(db: Db, token: string): Promise<ValidSession | null> {
  const id = sha256Hex(token);
  const [row] = await db
    .select({
      id: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));
  if (!row) return null;

  const now = Date.now();
  if (row.expiresAt.getTime() <= now || row.lastSeenAt.getTime() + SESSION_IDLE_MS <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  if (now - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(now) }).where(eq(sessions.id, id));
  }

  return { id, user: { id: row.userId, displayName: row.displayName }, expiresAt: row.expiresAt };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** 登出所有设备 */
export async function revokeAllSessions(db: Db, userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** 清理已失效的 session（顺手在登录时调用，不需要定时任务）。 */
export async function deleteExpiredSessions(db: Db): Promise<void> {
  const now = new Date();
  await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, now), lt(sessions.lastSeenAt, new Date(now.getTime() - SESSION_IDLE_MS))));
}

import { eq, lt, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { commenterSessions, commenters, oauthStates } from "../db/schema.ts";
import { randomToken, sha256Hex } from "./tokens.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/*
 * 评论者的 session：做法和管理员的完全一样（随机 token、库里只存哈希、闲置 + 绝对过期），
 * 但期限更长——评论者的权限只是发评论，频繁要求重新登录得不偿失。
 */
export const COMMENTER_SESSION_IDLE_MS = 30 * DAY;
export const COMMENTER_SESSION_MAX_MS = 90 * DAY;
const TOUCH_INTERVAL_MS = HOUR;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type Commenter = typeof commenters.$inferSelect;
export type CommenterSession = { id: string; commenter: Commenter };

export async function createCommenterSession(db: Db, commenterId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + COMMENTER_SESSION_MAX_MS);
  // 顺手清掉已失效的 session，不需要定时任务
  await db
    .delete(commenterSessions)
    .where(or(lt(commenterSessions.expiresAt, now), lt(commenterSessions.lastSeenAt, new Date(now.getTime() - COMMENTER_SESSION_IDLE_MS))));
  await db.insert(commenterSessions).values({ id: sha256Hex(token), commenterId, createdAt: now, lastSeenAt: now, expiresAt });
  return { token, expiresAt };
}

export async function validateCommenterSession(db: Db, token: string): Promise<CommenterSession | null> {
  const id = sha256Hex(token);
  const [row] = await db
    .select({ session: commenterSessions, commenter: commenters })
    .from(commenterSessions)
    .innerJoin(commenters, eq(commenters.id, commenterSessions.commenterId))
    .where(eq(commenterSessions.id, id));
  if (!row) return null;

  const now = Date.now();
  if (row.session.expiresAt.getTime() <= now || row.session.lastSeenAt.getTime() + COMMENTER_SESSION_IDLE_MS <= now) {
    await db.delete(commenterSessions).where(eq(commenterSessions.id, id));
    return null;
  }
  if (now - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(commenterSessions).set({ lastSeenAt: new Date(now) }).where(eq(commenterSessions.id, id));
  }
  return { id, commenter: row.commenter };
}

export async function revokeCommenterSession(db: Db, id: string): Promise<void> {
  await db.delete(commenterSessions).where(eq(commenterSessions.id, id));
}

/** 记下一次进行中的 OAuth 登录，返回 state */
export async function saveOAuthState(db: Db, data: { codeVerifier: string; returnTo: string }): Promise<string> {
  const id = randomToken();
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  await db.insert(oauthStates).values({ id, ...data, expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS) });
  return id;
}

/** 一次性取出（DELETE … RETURNING）：同一个 state 只能完成一次登录 */
export async function consumeOAuthState(db: Db, id: string): Promise<{ codeVerifier: string; returnTo: string } | null> {
  const [row] = await db.delete(oauthStates).where(eq(oauthStates.id, id)).returning();
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return { codeVerifier: row.codeVerifier, returnTo: row.returnTo };
}

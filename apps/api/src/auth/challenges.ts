import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { authChallenges } from "../db/schema.ts";
import { randomToken } from "./tokens.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type Kind = (typeof authChallenges.$inferSelect)["kind"];
export type StoredChallenge = typeof authChallenges.$inferSelect;

/** 保存 challenge，返回放进 cookie 的 id。顺手清掉过期的旧记录。 */
export async function saveChallenge(
  db: Db,
  data: { challenge: string; kind: Kind; webauthnUserId?: string; userId?: number },
): Promise<string> {
  const id = randomToken();
  await db.delete(authChallenges).where(lt(authChallenges.expiresAt, new Date()));
  await db.insert(authChallenges).values({
    id,
    challenge: data.challenge,
    kind: data.kind,
    webauthnUserId: data.webauthnUserId ?? null,
    userId: data.userId ?? null,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  return id;
}

/**
 * 取出并删除 challenge（DELETE … RETURNING 是原子操作）：同一个 challenge 只能用一次，
 * 即使同一个响应被并发提交两次，也只有一个请求能拿到它——这就是防重放。
 */
export async function consumeChallenge(db: Db, id: string | undefined, kind: Kind): Promise<StoredChallenge | null> {
  if (!id) return null;
  const [row] = await db
    .delete(authChallenges)
    .where(and(eq(authChallenges.id, id), eq(authChallenges.kind, kind)))
    .returning();
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

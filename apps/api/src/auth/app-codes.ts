import { APP_AUTH_CODE_TTL_MS } from "@blog/shared";
import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appAuthCodes } from "../db/schema.ts";
import { randomToken, safeEqual, sha256Hex } from "./tokens.ts";

/** 管理员在网站上允许 App 登录：生成一次性授权码，库里只存哈希。顺手清掉过期的旧授权码 */
export async function createAppCode(db: Db, data: { userId: number; codeChallenge: string; deviceName: string }): Promise<string> {
  const code = randomToken();
  await db.delete(appAuthCodes).where(lt(appAuthCodes.expiresAt, new Date()));
  await db.insert(appAuthCodes).values({
    id: sha256Hex(code),
    userId: data.userId,
    codeChallenge: data.codeChallenge,
    deviceName: data.deviceName,
    expiresAt: new Date(Date.now() + APP_AUTH_CODE_TTL_MS),
  });
  return code;
}

/**
 * 用授权码 + code_verifier 换 token 时取出授权码：DELETE … RETURNING 原子地取出并删除，只能用一次；
 * 过期或 verifier 对不上都返回 null（授权码已经删掉，猜错一次就作废，不能反复试）。
 */
export async function consumeAppCode(db: Db, code: string, codeVerifier: string): Promise<{ userId: number; deviceName: string } | null> {
  const [row] = await db.delete(appAuthCodes).where(eq(appAuthCodes.id, sha256Hex(code))).returning();
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  // PKCE S256：拿到授权码的人还必须知道发起登录的 App 手里的 verifier
  if (!safeEqual(pkceChallenge(codeVerifier), row.codeChallenge)) return null;
  return { userId: row.userId, deviceName: row.deviceName };
}

export function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

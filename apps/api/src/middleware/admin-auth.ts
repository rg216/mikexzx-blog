import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { errorBody } from "../lib/errors.ts";

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/**
 * v1 的临时管理员鉴权：Authorization: Bearer <ADMIN_TOKEN>。v2 换成 session。
 *
 * 比较前先各自做 SHA-256：timingSafeEqual 要求两边等长，哈希后长度固定；
 * 用 === 比较字符串会在第一个不同字符处提前返回，响应时间会泄露"猜对了几位"。
 */
export function adminAuth(token: string): MiddlewareHandler {
  const expected = sha256(token);

  return async (c, next) => {
    const match = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "");
    if (!match?.[1] || !timingSafeEqual(sha256(match[1]), expected)) {
      c.header("WWW-Authenticate", 'Bearer realm="admin"');
      return c.json(errorBody("unauthorized", "需要管理员凭证"), 401);
    }
    await next();
  };
}

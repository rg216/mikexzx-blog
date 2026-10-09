import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AuthConfig } from "../auth/config.ts";
import { getSessionCookie } from "../auth/cookies.ts";
import { type ValidSession, validateSession } from "../auth/sessions.ts";
import type { Db } from "../db/client.ts";
import { errorBody, HttpError } from "../lib/errors.ts";

export type AuthEnv = { Variables: { session: ValidSession | null } };

/** 读取 session cookie，把有效的 session（或 null）放进 c.var.session。不拦截请求。 */
export function loadSession(db: Db, config: AuthConfig) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = getSessionCookie(c, config);
    c.set("session", token ? await validateSession(db, token) : null);
    await next();
  });
}

/** 必须已登录，否则 401。要放在 loadSession 之后。 */
export const requireSession = createMiddleware<AuthEnv>(async (c, next) => {
  if (!c.get("session")) return c.json(errorBody("unauthorized", "请先登录"), 401);
  await next();
});

/** 在 requireSession 之后取当前 session（类型上去掉 null）。 */
export function sessionOf(c: Context<AuthEnv>): ValidSession {
  const session = c.get("session");
  if (!session) throw new HttpError(401, "unauthorized", "请先登录");
  return session;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF 第二道防线：会改变状态的请求，Origin 头必须是我们自己的前端。
 * 第一道是 SameSite=Lax（跨站请求不带 cookie）；这一道防的是浏览器 bug、同站的其他子域等情况。
 * 现代浏览器对所有 POST/PATCH/DELETE 都会带 Origin，所以缺失也直接拒绝。
 */
export function requireSameOrigin(config: AuthConfig) {
  return createMiddleware(async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header("origin") !== config.webOrigin) {
      return c.json(errorBody("forbidden", "请求来源不被允许"), 403);
    }
    await next();
  });
}

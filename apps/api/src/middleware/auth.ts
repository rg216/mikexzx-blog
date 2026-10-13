import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AuthConfig } from "../auth/config.ts";
import { type CommenterSession, validateCommenterSession } from "../auth/commenter-sessions.ts";
import { getCommenterCookie, getSessionCookie } from "../auth/cookies.ts";
import { type ValidSession, validateSession } from "../auth/sessions.ts";
import type { Db } from "../db/client.ts";
import { errorBody, HttpError } from "../lib/errors.ts";

/** session：管理员（Passkey）；commenter：评论者（GitHub）。两者互不相干，同一个浏览器可以同时有、也可以都没有 */
export type AuthEnv = { Variables: { session: ValidSession | null; commenter: CommenterSession | null } };

/**
 * 原生 App 的 session 放在 `Authorization: Bearer <token>` 里（见 @blog/shared 的 app-auth.ts），
 * 和 cookie 里的是同一种 session。格式不对的头当作没有
 */
function bearerToken(c: Context): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{1,200})$/.exec(c.req.header("authorization") ?? "");
  return match?.[1];
}

/** 带 Bearer token、不带任何 cookie 的请求：原生 App 发来的 */
function isBearerOnly(c: Context): boolean {
  return bearerToken(c) !== undefined && c.req.header("cookie") === undefined;
}

/**
 * 读取 session（App 的 Bearer token 或浏览器的 cookie），把有效的 session（或 null）放进 c.var.session。不拦截请求。
 * 带了 Bearer 头就只认它，不再看 cookie：一个请求只有一种身份。
 */
export function loadSession(db: Db, config: AuthConfig) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const bearer = bearerToken(c);
    const token = bearer ?? getSessionCookie(c, config);
    c.set("session", token ? await validateSession(db, token) : null);
    await next();
  });
}

/** 读取评论者的 cookie，放进 c.var.commenter。不拦截请求。 */
export function loadCommenter(db: Db, config: AuthConfig) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = getCommenterCookie(c, config);
    c.set("commenter", token ? await validateCommenterSession(db, token) : null);
    await next();
  });
}

/** 必须是登录的评论者，否则 401；返回当前评论者 */
export function commenterOf(c: Context<AuthEnv>): CommenterSession {
  const commenter = c.get("commenter");
  if (!commenter) throw new HttpError(401, "unauthorized", "请先用 GitHub 登录");
  return commenter;
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
 * 不靠 cookie 的请求，CSRF 无从谈起（CSRF 利用的是浏览器自动带上的 cookie），不检查 Origin：
 * - 原生 App 用 Bearer token 的请求（浏览器跨站发不出 Authorization 头：它不是"简单请求"头，要过 CORS 预检，而 API 不允许跨域）
 * - App 用授权码换 token：凭的是请求体里的授权码和 PKCE verifier
 */
const COOKIELESS_PATHS = new Set(["/auth/app/token"]);

/**
 * CSRF 第二道防线：会改变状态的请求，Origin 头必须是我们自己的前端。
 * 第一道是 SameSite=Lax（跨站请求不带 cookie）；这一道防的是浏览器 bug、同站的其他子域等情况。
 * 现代浏览器对所有 POST/PATCH/DELETE 都会带 Origin，所以缺失也直接拒绝（不靠 cookie 的请求除外，见上）。
 */
export function requireSameOrigin(config: AuthConfig) {
  return createMiddleware(async (c, next) => {
    const cookieless = isBearerOnly(c) || (COOKIELESS_PATHS.has(c.req.path) && c.req.header("cookie") === undefined);
    if (!SAFE_METHODS.has(c.req.method) && !cookieless && c.req.header("origin") !== config.webOrigin) {
      return c.json(errorBody("forbidden", "请求来源不被允许"), 403);
    }
    await next();
  });
}

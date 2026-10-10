import type { CommenterMe } from "@blog/shared";
import { Hono } from "hono";
import type { AuthConfig } from "../auth/config.ts";
import {
  clearCommenterCookie,
  clearOAuthStateCookie,
  getOAuthStateCookie,
  setCommenterCookie,
  setOAuthStateCookie,
} from "../auth/cookies.ts";
import { consumeOAuthState, createCommenterSession, revokeCommenterSession, saveOAuthState } from "../auth/commenter-sessions.ts";
import type { GitHub } from "../auth/github.ts";
import { randomToken, safeEqual } from "../auth/tokens.ts";
import type { Db } from "../db/client.ts";
import { clientIp } from "../lib/client-ip.ts";
import { type RateLimiter, rateLimit, rules } from "../lib/rate-limit.ts";
import { safeReturnPath, withQuery } from "../lib/safe-path.ts";
import type { AuthEnv } from "../middleware/auth.ts";
import { upsertCommenter } from "../services/comments.ts";

/**
 * 评论者的 GitHub 登录（挂在 /auth/github 下）。浏览器经前端的 /api 代理访问，
 * 所以 cookie 属于前端域名；GitHub 的回调地址也是 <前端>/api/auth/github/callback。
 */
export function commenterAuthRoutes(db: Db, config: AuthConfig, github: GitHub | null, limiter: RateLimiter) {
  return (
    new Hono<AuthEnv>()
      .get("/me", (c) => {
        const commenter = c.get("commenter")?.commenter;
        return c.json({
          configured: github !== null,
          commenter: commenter
            ? { login: commenter.login, name: commenter.name, avatarUrl: commenter.avatarUrl, trust: commenter.trust }
            : null,
        } satisfies CommenterMe);
      })
      /** 第一步：记下 state 和 PKCE 的 verifier，把浏览器送去 GitHub 授权页 */
      .get(
        "/start",
        rateLimit(limiter, rules.auth, (c) => clientIp(c)),
        async (c) => {
          const returnTo = safeReturnPath(c.req.query("next"));
          if (!github) return c.redirect(withQuery(returnTo, { login: "unavailable" }), 302);
          const codeVerifier = randomToken(32);
          const state = await saveOAuthState(db, { codeVerifier, returnTo });
          setOAuthStateCookie(c, config, state);
          return c.redirect(github.authorizeUrl(state, codeVerifier), 302);
        },
      )
      /**
       * 第二步：GitHub 带着 code 和 state 跳回来。state 必须与 cookie 一致且未被用过，
       * 然后换 token、读资料、建 session，回到登录前的页面。失败时也回去，用 ?login=failed 告诉前端。
       */
      .get("/callback", async (c) => {
        const state = c.req.query("state") ?? "";
        const cookieState = getOAuthStateCookie(c, config);
        clearOAuthStateCookie(c, config);
        const saved = state && cookieState && safeEqual(state, cookieState) ? await consumeOAuthState(db, state) : null;
        const returnTo = saved?.returnTo ?? "/";

        const code = c.req.query("code");
        if (!github || !saved || !code) {
          // 用户在 GitHub 上点了取消：error=access_denied
          const result = c.req.query("error") === "access_denied" ? "cancelled" : "failed";
          return c.redirect(withQuery(returnTo, { login: result }), 302);
        }

        try {
          const token = await github.exchangeCode(code, saved.codeVerifier);
          const commenter = await upsertCommenter(db, await github.fetchUser(token));
          const session = await createCommenterSession(db, commenter.id);
          setCommenterCookie(c, config, session.token);
          return c.redirect(returnTo, 302);
        } catch (error) {
          console.error("github login failed:", error instanceof Error ? error.message : error);
          return c.redirect(withQuery(returnTo, { login: "failed" }), 302);
        }
      })
      .post("/logout", async (c) => {
        const session = c.get("commenter");
        if (session) await revokeCommenterSession(db, session.id);
        clearCommenterCookie(c, config);
        return c.body(null, 204);
      })
  );
}

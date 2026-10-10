import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthConfig } from "./config.ts";
import { COMMENTER_SESSION_MAX_MS } from "./commenter-sessions.ts";
import { SESSION_MAX_MS } from "./sessions.ts";

const CHALLENGE_MAX_AGE_S = 5 * 60;
const OAUTH_STATE_MAX_AGE_S = 10 * 60;

/*
 * __Host- 前缀：浏览器强制要求 Secure、Path=/、不能设 Domain——cookie 只属于当前主机，
 * 子域名或其他站点无法覆盖它。本地 http 开发时 Secure 不可用，只能退回普通名字。
 */
function names(config: AuthConfig) {
  return config.secureCookies
    ? { session: "__Host-session", challenge: "__Host-webauthn", commenter: "__Host-commenter", oauth: "__Host-oauth" }
    : { session: "session", challenge: "webauthn", commenter: "commenter", oauth: "oauth" };
}

function baseOptions(config: AuthConfig) {
  return {
    httpOnly: true, // JS 读不到：XSS 也偷不走 session
    secure: config.secureCookies,
    sameSite: "Lax", // 跨站的 POST/fetch 不带 cookie（CSRF 第一道防线），从外部链接点进来仍保持登录
    path: "/",
  } as const;
}

export function getSessionCookie(c: Context, config: AuthConfig): string | undefined {
  return getCookie(c, names(config).session);
}

export function setSessionCookie(c: Context, config: AuthConfig, token: string): void {
  setCookie(c, names(config).session, token, { ...baseOptions(config), maxAge: SESSION_MAX_MS / 1000 });
}

export function clearSessionCookie(c: Context, config: AuthConfig): void {
  deleteCookie(c, names(config).session, baseOptions(config));
}

export function getChallengeCookie(c: Context, config: AuthConfig): string | undefined {
  return getCookie(c, names(config).challenge);
}

export function setChallengeCookie(c: Context, config: AuthConfig, challengeId: string): void {
  // Strict：challenge 只在本站的登录页里用，不需要跨站携带
  setCookie(c, names(config).challenge, challengeId, {
    ...baseOptions(config),
    sameSite: "Strict",
    maxAge: CHALLENGE_MAX_AGE_S,
  });
}

export function clearChallengeCookie(c: Context, config: AuthConfig): void {
  deleteCookie(c, names(config).challenge, { ...baseOptions(config), sameSite: "Strict" });
}

// ---------- 评论者（GitHub 登录） ----------

export function getCommenterCookie(c: Context, config: AuthConfig): string | undefined {
  return getCookie(c, names(config).commenter);
}

export function setCommenterCookie(c: Context, config: AuthConfig, token: string): void {
  setCookie(c, names(config).commenter, token, { ...baseOptions(config), maxAge: COMMENTER_SESSION_MAX_MS / 1000 });
}

export function clearCommenterCookie(c: Context, config: AuthConfig): void {
  deleteCookie(c, names(config).commenter, baseOptions(config));
}

/**
 * OAuth 的 state 也放一份在 cookie 里：回调时 URL 里的 state 必须与 cookie 一致，
 * 证明"发起登录"和"完成登录"是同一个浏览器（防止攻击者把自己的授权码塞给你，让你登录成他）。
 * 必须是 Lax 而不是 Strict：从 github.com 跳回来是跨站导航，Strict 的 cookie 不会被带上。
 */
export function getOAuthStateCookie(c: Context, config: AuthConfig): string | undefined {
  return getCookie(c, names(config).oauth);
}

export function setOAuthStateCookie(c: Context, config: AuthConfig, state: string): void {
  setCookie(c, names(config).oauth, state, { ...baseOptions(config), maxAge: OAUTH_STATE_MAX_AGE_S });
}

export function clearOAuthStateCookie(c: Context, config: AuthConfig): void {
  deleteCookie(c, names(config).oauth, baseOptions(config));
}


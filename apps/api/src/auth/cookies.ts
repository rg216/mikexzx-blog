import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthConfig } from "./config.ts";
import { SESSION_MAX_MS } from "./sessions.ts";

const CHALLENGE_MAX_AGE_S = 5 * 60;

/*
 * __Host- 前缀：浏览器强制要求 Secure、Path=/、不能设 Domain——cookie 只属于当前主机，
 * 子域名或其他站点无法覆盖它。本地 http 开发时 Secure 不可用，只能退回普通名字。
 */
function names(config: AuthConfig) {
  return config.secureCookies
    ? { session: "__Host-session", challenge: "__Host-webauthn" }
    : { session: "session", challenge: "webauthn" };
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

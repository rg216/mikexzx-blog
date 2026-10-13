import { z } from "zod";
import { sessionInfoSchema } from "./auth.ts";

/*
 * 原生 App（mikexxz-blog-apple）登录后台：RFC 8252（OAuth 2.0 for Native Apps）的做法。
 *
 * 1. App 生成 code_verifier，在 ASWebAuthenticationSession 里打开网站的 /admin/authorize-app?challenge=…&state=…&device=…
 * 2. 那个页面在后台里（没登录就先用 Passkey 登录），管理员点"允许"后 POST /auth/app/codes（cookie session）拿到一次性授权码，
 *    跳到 APP_AUTH_REDIRECT_URI?code=…&state=…；ASWebAuthenticationSession 把这个地址直接交还给发起它的 App
 * 3. App 用授权码 + code_verifier 换 token（POST /auth/app/token），之后请求带 Authorization: Bearer
 *
 * 为什么不在 App 里直接用 Passkey：Passkey 绑定网站的域名（RP ID），原生 App 要用就得配 Associated Domains
 * （网站上放 apple-app-site-association、App 带开发者团队的签名）。走浏览器则什么都不用配，Passkey 照常在网站上用。
 */

/** App 接收授权码的地址。只接受这一个：授权码不会被交给别的地址 */
export const APP_AUTH_REDIRECT_URI = "mikexxz-blog://auth/callback";

/** 授权码几分钟内有效（只是从浏览器跳回 App 的这一下） */
export const APP_AUTH_CODE_TTL_MS = 2 * 60 * 1000;

/** PKCE（RFC 7636）S256：base64url(SHA-256(code_verifier))，固定 43 个字符 */
export const pkceChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "无效的 code_challenge");

/** code_verifier：43–128 个 unreserved 字符 */
export const pkceVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, "无效的 code_verifier");

/** 发起登录的设备名（"Mike 的 iPhone"），显示在授权页上，也记在 session 里 */
export const appDeviceNameSchema = z.string().trim().min(1).max(60);

export const appAuthCodeInputSchema = z.strictObject({
  codeChallenge: pkceChallengeSchema,
  deviceName: appDeviceNameSchema,
});
export type AppAuthCodeInput = z.infer<typeof appAuthCodeInputSchema>;

export const appAuthCodeSchema = z.object({ code: z.string() });
export type AppAuthCode = z.infer<typeof appAuthCodeSchema>;

export const appTokenInputSchema = z.strictObject({
  code: z.string().min(1).max(200),
  codeVerifier: pkceVerifierSchema,
});
export type AppTokenInput = z.infer<typeof appTokenInputSchema>;

/** token 就是一个 session（和网站登录同样的有效期规则），只是放在 Authorization 头里而不是 cookie 里 */
export const appTokenSchema = sessionInfoSchema.extend({ token: z.string() });
export type AppToken = z.infer<typeof appTokenSchema>;

/** 授权页的查询参数 */
export const appAuthorizeQuerySchema = z.object({
  challenge: pkceChallengeSchema,
  state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, "无效的 state"),
  device: appDeviceNameSchema,
  redirect_uri: z.literal(APP_AUTH_REDIRECT_URI),
});
export type AppAuthorizeQuery = z.infer<typeof appAuthorizeQuerySchema>;

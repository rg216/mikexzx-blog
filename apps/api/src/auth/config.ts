/** 鉴权相关配置，由 WEB_ORIGIN 推导，避免多处各自拼接 */
export type AuthConfig = {
  /** 前端的源，如 https://mikexzx-blog.vercel.app */
  webOrigin: string;
  /** WebAuthn 的 RP ID = 前端主机名。Passkey 与它绑定，换域名需要重新注册 */
  rpID: string;
  rpName: string;
  /** https 下 cookie 加 Secure 和 __Host- 前缀；本地 http://localhost 开发时不加 */
  secureCookies: boolean;
  setupToken: string | undefined;
};

export function createAuthConfig({ webOrigin, setupToken }: { webOrigin: string; setupToken?: string }): AuthConfig {
  const url = new URL(webOrigin);
  return {
    webOrigin: url.origin,
    rpID: url.hostname,
    rpName: "mikexxz",
    secureCookies: url.protocol === "https:",
    setupToken,
  };
}

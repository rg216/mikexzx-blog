import type { Context } from "hono";

/**
 * 客户端 IP（用于按 IP 限流、阅读去重）。
 * 取 X-Forwarded-For 的第一个地址：Vercel 会用真实客户端 IP 覆写这个头；
 * 本地经 Next rewrites 代理、以后 VPS 上经 Caddy 代理时，由代理设置。
 * 注意：只有部署在会覆写该头的代理之后才可信，直接暴露在公网时客户端可以伪造它。
 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || c.req.header("x-real-ip") || "unknown";
}

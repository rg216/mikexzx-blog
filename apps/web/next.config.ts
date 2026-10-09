import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:8787";

const nextConfig: NextConfig = {
  // @blog/shared 直接导出 TS 源码（无构建步骤），需要 Next 来转译。
  transpilePackages: ["@blog/shared"],
  poweredByHeader: false,
  // next dev 检测到 AI 编程助手时会生成 AGENTS.md；项目统一用根目录的 CLAUDE.md，关掉以免重复
  agentRules: false,
  /*
   * 把 /api/* 反向代理到 apps/api。浏览器只和前端这一个站点通信：
   * - 前端与 API 都在 *.vercel.app 下，而 vercel.app 在公共后缀列表里，两者对浏览器来说是"不同站点"，
   *   跨站 cookie 会被拦截；代理后 session cookie 是第一方的，可以用 SameSite=Lax + __Host- 前缀；
   * - Passkey 的 RP ID 必须是前端的域名，整个登录流程都在前端源下完成。
   * 服务端渲染取数据（lib/api.ts）仍然直连 API_URL，不经过这层代理。
   */
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;

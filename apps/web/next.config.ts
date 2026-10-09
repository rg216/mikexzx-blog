import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @blog/shared 直接导出 TS 源码（无构建步骤），需要 Next 来转译。
  transpilePackages: ["@blog/shared"],
  poweredByHeader: false,
  // next dev 检测到 AI 编程助手时会生成 AGENTS.md；项目统一用根目录的 CLAUDE.md，关掉以免重复
  agentRules: false,
};

export default nextConfig;

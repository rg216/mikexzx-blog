import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @blog/shared 直接导出 TS 源码（无构建步骤），需要 Next 来转译。
  transpilePackages: ["@blog/shared"],
  poweredByHeader: false,
};

export default nextConfig;

import { readFileSync } from "node:fs";
import { build } from "esbuild";

/*
 * 部署用的打包：src/index.ts → dist/index.js（单文件）。
 *
 * 为什么不直接让 Vercel 编译 src/：本地用 Node 原生 type stripping 运行 TS，相对导入必须写 .ts 扩展名；
 * Vercel 的构建器把文件编译成 .js 却不改写这些导入，运行时找不到模块。自己打成一个文件就没有相对导入了。
 *
 * - workspace 包（@blog/shared，只有 TS 源码）打进 bundle；
 * - npm 依赖保持 external，由平台安装 / 追踪（Vercel 的入口检测还要求 bundle 里留着 from "hono"）。
 */
type PackageJson = { dependencies?: Record<string, string> };
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as PackageJson;
const external = Object.entries(pkg.dependencies ?? {})
  .filter(([, version]) => !version.startsWith("workspace:"))
  .map(([name]) => name);

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // 子路径（如 hono/logger、drizzle-orm/pg-core）也要 external
  external: external.flatMap((name) => [name, `${name}/*`]),
  sourcemap: true,
  logLevel: "info",
});

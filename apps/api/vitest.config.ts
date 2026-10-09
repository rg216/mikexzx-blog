import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // 所有测试文件共用一个测试库，并行会互相清空数据，所以串行执行
    fileParallelism: false,
    env: {
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://blog:blog@localhost:5432/blog_test",
    },
  },
});

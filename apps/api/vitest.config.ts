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
      // 用 15 号库，与开发数据（0 号库）隔离；需要 Redis 的测试每次开始前清空它
      TEST_REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15",
      // docker compose 里的 RustFS，测试用单独的存储桶
      TEST_S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? "http://localhost:9000",
      TEST_S3_BUCKET: process.env.TEST_S3_BUCKET ?? "blog-images-test",
    },
  },
});

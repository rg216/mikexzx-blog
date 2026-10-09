import { runMigrations } from "../src/db/migrate.ts";

// 所有测试开始前执行一次：把测试库迁移到最新结构（迁移本身也因此被测试到）
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://blog:blog@localhost:5432/blog_test";
  try {
    await runMigrations(url);
  } catch (error) {
    throw new Error(`无法迁移测试库 ${url}，Postgres 启动了吗？（docker compose up -d）`, { cause: error });
  }
}

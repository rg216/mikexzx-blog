import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // 代码里写 camelCase，数据库里自动对应 snake_case（contentMd ↔ content_md）
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://blog:blog@localhost:5432/blog" },
  strict: true,
});

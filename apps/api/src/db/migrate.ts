import { fileURLToPath } from "node:url";
import { isNull } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { reindexPosts } from "../services/posts.ts";
import { createDb } from "./client.ts";
import { posts } from "./schema.ts";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * 执行迁移，然后补齐搜索索引为 NULL 的文章。
 * 索引由应用里的分词代码生成，SQL 迁移做不了，所以放在迁移之后：新加列时补齐旧文章，
 * 以后改了分词规则，写一个把 search_vector 置为 NULL 的迁移就会在这里全部重建。
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, pool } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder });
    const reindexed = await reindexPosts(db, isNull(posts.searchVector));
    if (reindexed > 0) console.log(`search index built for ${reindexed} post(s)`);
  } finally {
    await pool.end();
  }
}

// 作为脚本直接运行时（bun run db:migrate）
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("缺少 DATABASE_URL");
  await runMigrations(url);
  console.log("migrations applied");
}

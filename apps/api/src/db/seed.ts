import { postCreateInputSchema } from "@blog/shared";
import { eq } from "drizzle-orm";
import { createPost } from "../services/posts.ts";
import { createDb } from "./client.ts";
import { posts } from "./schema.ts";
import { seedPosts } from "./seed-data.ts";

// 幂等：已存在的 slug 跳过，可以反复运行
const url = process.env.DATABASE_URL;
if (!url) throw new Error("缺少 DATABASE_URL");

const { db, pool } = createDb(url);
try {
  for (const input of seedPosts) {
    const data = postCreateInputSchema.parse(input);
    const [existing] = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, data.slug));
    if (existing) {
      console.log(`skip    ${data.slug}`);
      continue;
    }
    await createPost(db, data);
    console.log(`created ${data.slug}`);
  }
} finally {
  await pool.end();
}

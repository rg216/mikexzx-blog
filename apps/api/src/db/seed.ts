import { createDb } from "./client.ts";
import { seedDatabase } from "./seed-database.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("缺少 DATABASE_URL");

const { db, pool } = createDb(url);
try {
  await seedDatabase(db);
} finally {
  await pool.end();
}

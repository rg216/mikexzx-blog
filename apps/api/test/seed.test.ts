import { adminPostSchema } from "@blog/shared";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { posts, postTranslations } from "../src/db/schema.ts";
import { seedDatabase } from "../src/db/seed-database.ts";
import { seedTranslations } from "../src/db/seed-data.ts";
import { setupTestApp } from "./helpers.ts";

const { db, request } = setupTestApp();
const quiet = () => {};

const getPostBySlug = async (slug: string) => {
  const [row] = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug));
  if (!row) throw new Error(`missing ${slug}`);
  return adminPostSchema.parse((await request("GET", `/admin/posts/${row.id}`)).body);
};

describe("seedDatabase", () => {
  it("writes every seed translation as up to date on a fresh database (seed data has not drifted)", async () => {
    await seedDatabase(db, quiet);
    expect(seedTranslations.length).toBeGreaterThan(0);
    for (const { slug, locale } of seedTranslations) {
      const post = await getPostBySlug(slug);
      expect(post.translations.find((t) => t.locale === locale)).toMatchObject({ outdated: false });
    }
  });

  it("marks a translation as outdated when the original in the database differs from the seed original", async () => {
    const [first] = seedTranslations;
    if (!first) throw new Error("no seed translations");
    await seedDatabase(db, quiet);
    const post = await getPostBySlug(first.slug);
    // 本地改过原文，又删掉了译文，再跑一次 seed：译文依据的是种子原文，不是改过的原文
    const patched = await request("PATCH", `/admin/posts/${post.id}`, { body: { title: `${post.title}（改）` } });
    expect(patched.status).toBe(200);
    await db.delete(postTranslations).where(and(eq(postTranslations.postId, post.id), eq(postTranslations.locale, first.locale)));

    await seedDatabase(db, quiet);
    const after = await getPostBySlug(first.slug);
    expect(after.translations.find((t) => t.locale === first.locale)).toMatchObject({ outdated: true });
  });
});

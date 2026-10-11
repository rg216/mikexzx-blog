import { postCreateInputSchema, tagInputSchema, translationInputSchema } from "@blog/shared";
import { and, eq } from "drizzle-orm";
import { sourceHash } from "../lib/source-hash.ts";
import { createPost } from "../services/posts.ts";
import { upsertTranslation } from "../services/translations.ts";
import type { Db } from "./client.ts";
import { posts, postTranslations, tags } from "./schema.ts";
import { seedPosts, seedTags, seedTranslations } from "./seed-data.ts";

/** 写入种子标签、文章和译文。幂等：已存在的标签 / slug / 译文跳过，可以反复运行 */
export async function seedDatabase(db: Db, log: (line: string) => void = console.log): Promise<void> {
  // 文章只能引用已有标签，先写标签
  await db
    .insert(tags)
    .values(seedTags.map((tag) => tagInputSchema.parse(tag)))
    .onConflictDoNothing();

  for (const input of seedPosts) {
    const data = postCreateInputSchema.parse(input);
    const [existing] = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, data.slug));
    if (existing) {
      log(`skip    ${data.slug}`);
      continue;
    }
    await createPost(db, data);
    log(`created ${data.slug}`);
  }

  for (const { slug, locale, title, contentMd } of seedTranslations) {
    const label = `${slug} (${locale})`;
    const original = seedPosts.find((p) => p.slug === slug);
    if (!original) throw new Error(`seed translation for unknown seed post ${slug}`);
    const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug));
    if (!post) throw new Error(`seed translation for missing post ${slug}`);
    const [existing] = await db
      .select({ postId: postTranslations.postId })
      .from(postTranslations)
      .where(and(eq(postTranslations.postId, post.id), eq(postTranslations.locale, locale)));
    if (existing) {
      log(`skip    ${label}`);
      continue;
    }
    // 指纹取译文所依据的种子原文，而不是库里当前的原文：如果本地改过这篇原文，译文会如实显示为过时。
    // 先过一遍 schema（会 trim 标题），与 createPost 存进库里的值一致，否则新库上也会误报过时
    const parsed = postCreateInputSchema.parse(original);
    const data = translationInputSchema.parse({ title, contentMd, sourceHash: sourceHash({ title: parsed.title, contentMd: parsed.contentMd }) });
    await upsertTranslation(db, post.id, locale, data);
    log(`created ${label}`);
  }
}

import {
  type AdminTranslation,
  type AdminTranslationSummary,
  type Locale,
  localeInfo,
  locales,
  type PostStatus,
  type translationInputSchema,
} from "@blog/shared";
import { and, eq, getTableColumns, inArray, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client.ts";
import { posts, postTranslations } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { excerptFromMarkdown } from "../lib/excerpt.ts";
import { sourceHash } from "../lib/source-hash.ts";
import { syncPostImages } from "./images.ts";
import { type Executor, searchVectorOf, tagsByPostId } from "./post-common.ts";

type TranslationData = z.output<typeof translationInputSchema>;
type TranslationRow = typeof postTranslations.$inferSelect;

/** 按 locales 的顺序排（数据库里按主键是字母序，en < ja < zh，和站点的语言顺序无关） */
export const byLocaleOrder = (a: { locale: Locale }, b: { locale: Locale }) => locales.indexOf(a.locale) - locales.indexOf(b.locale);

/** 译文是否过时：保存译文时依据的原文指纹与当前原文的指纹不一致 */
export const isOutdated = (translationSourceHash: string, currentSourceHash: string) => translationSourceHash !== currentSourceHash;

const summaryColumns = {
  postId: postTranslations.postId,
  locale: postTranslations.locale,
  title: postTranslations.title,
  origin: postTranslations.origin,
  model: postTranslations.model,
  translatedAt: postTranslations.translatedAt,
  sourceHash: postTranslations.sourceHash,
};
type SummaryRow = Pick<TranslationRow, keyof typeof summaryColumns>;

function toSummary(row: SummaryRow, currentSourceHash: string): AdminTranslationSummary {
  return {
    locale: row.locale,
    title: row.title,
    origin: row.origin,
    model: row.model,
    translatedAt: row.translatedAt.toISOString(),
    sourceHash: row.sourceHash,
    outdated: isOutdated(row.sourceHash, currentSourceHash),
  };
}

function toAdminTranslation(row: Omit<TranslationRow, "searchVector">, currentSourceHash: string): AdminTranslation {
  return { ...toSummary(row, currentSourceHash), contentMd: row.contentMd, excerpt: row.excerpt };
}

/**
 * 一次查出多篇文章的译文概要（后台文章列表用，避免 N+1）。
 * currentHashes：每篇文章当前原文的指纹，用来算 outdated。
 */
export async function translationSummariesByPostId(
  db: Executor,
  currentHashes: Map<number, string>,
): Promise<Map<number, AdminTranslationSummary[]>> {
  const result = new Map<number, AdminTranslationSummary[]>([...currentHashes.keys()].map((id) => [id, []]));
  if (currentHashes.size === 0) return result;
  const rows = await db
    .select(summaryColumns)
    .from(postTranslations)
    .where(inArray(postTranslations.postId, [...currentHashes.keys()]));
  for (const row of rows.sort(byLocaleOrder)) result.get(row.postId)?.push(toSummary(row, currentHashes.get(row.postId) ?? ""));
  return result;
}

type PostForTranslation = { id: number; slug: string; status: PostStatus; sourceLocale: Locale; title: string; contentMd: string };

async function findPost(db: Executor, postId: number, { lock = false } = {}): Promise<PostForTranslation> {
  const query = db
    .select({ id: posts.id, slug: posts.slug, status: posts.status, sourceLocale: posts.sourceLocale, title: posts.title, contentMd: posts.contentMd })
    .from(posts)
    .where(eq(posts.id, postId));
  // 锁住文章这一行：与同时进行的原文保存、另一个译文保存串行，"之前有没有译文"的判断和图片引用的重建不会互相踩
  const [post] = lock ? await query.for("update") : await query;
  if (!post) throw new HttpError(404, "not_found", "文章不存在");
  return post;
}

// 搜索索引只在搜索时用到，其他查询都不读它（长译文的索引可能有几百 KB）
const { searchVector: _searchVector, ...columns } = getTableColumns(postTranslations);
export const translationColumns = columns;

export async function getTranslation(db: Executor, postId: number, locale: Locale): Promise<AdminTranslation | null> {
  const post = await findPost(db, postId);
  const [row] = await db
    .select(translationColumns)
    .from(postTranslations)
    .where(and(eq(postTranslations.postId, postId), eq(postTranslations.locale, locale)));
  return row ? toAdminTranslation(row, sourceHash(post)) : null;
}

/** 文章当前的公开状态，加上这次操作前后该语言有没有译文：路由据此决定通知前端失效哪些缓存 */
export type TranslationChange = { slug: string; status: PostStatus; existedBefore: boolean };

/**
 * 新建或整体替换一篇译文（作者在后台手工编辑：origin 记为 human，model 为空）。
 * 摘要按该语言的长度生成；搜索索引用译文的标题、正文加上文章的标签（标签不翻译）。
 */
export async function upsertTranslation(
  db: Db,
  postId: number,
  locale: Locale,
  data: TranslationData,
): Promise<{ translation: AdminTranslation; change: TranslationChange }> {
  return db.transaction(async (tx) => {
    const post = await findPost(tx, postId, { lock: true });
    if (locale === post.sourceLocale) {
      throw new HttpError(400, "validation_error", "不能为原文语言添加译文");
    }
    const [existing] = await tx
      .select({ postId: postTranslations.postId })
      .from(postTranslations)
      .where(and(eq(postTranslations.postId, postId), eq(postTranslations.locale, locale)));

    const postTags = (await tagsByPostId(tx, [postId])).get(postId) ?? [];
    const values = {
      title: data.title,
      contentMd: data.contentMd,
      excerpt: excerptFromMarkdown(data.contentMd, localeInfo[locale].excerptLength),
      sourceHash: data.sourceHash,
      origin: "human" as const,
      model: null,
      translatedAt: new Date(),
      searchVector: searchVectorOf({ title: data.title, contentMd: data.contentMd, tags: postTags }),
    };
    const [row] = await tx
      .insert(postTranslations)
      .values({ postId, locale, ...values })
      .onConflictDoUpdate({ target: [postTranslations.postId, postTranslations.locale], set: values })
      .returning(translationColumns);
    if (!row) throw new Error("upsert returned no row");

    await syncPostImages(tx, postId);
    return {
      translation: toAdminTranslation(row, sourceHash(post)),
      change: { slug: post.slug, status: post.status, existedBefore: existing !== undefined },
    };
  });
}

/** 删除一篇译文；文章不存在或没有这篇译文时 404 */
export async function deleteTranslation(db: Db, postId: number, locale: Locale): Promise<TranslationChange> {
  return db.transaction(async (tx) => {
    const post = await findPost(tx, postId, { lock: true });
    const deleted = await tx
      .delete(postTranslations)
      .where(and(eq(postTranslations.postId, postId), eq(postTranslations.locale, locale)))
      .returning({ postId: postTranslations.postId });
    if (deleted.length === 0) throw new HttpError(404, "not_found", "译文不存在");
    // 只被这篇译文引用的图片不再算"被引用"
    await syncPostImages(tx, postId);
    return { slug: post.slug, status: post.status, existedBefore: true };
  });
}

/**
 * 重建符合条件的译文的搜索索引，返回处理的篇数。用于：文章的标签变了 / 标签改名（标签是索引里的 B 权重）；
 * 迁移后补齐 search_vector 为 NULL 的译文。不改 translated_at——这不是重新翻译。
 */
export async function reindexTranslations(db: Executor, where: SQL): Promise<number> {
  const rows = await db
    .select({ postId: postTranslations.postId, locale: postTranslations.locale, title: postTranslations.title, contentMd: postTranslations.contentMd })
    .from(postTranslations)
    .where(where);
  const tagMap = await tagsByPostId(db, [...new Set(rows.map((r) => r.postId))]);
  for (const row of rows) {
    await db
      .update(postTranslations)
      .set({ searchVector: searchVectorOf({ ...row, tags: tagMap.get(row.postId) ?? [] }) })
      .where(and(eq(postTranslations.postId, row.postId), eq(postTranslations.locale, row.locale)));
  }
  return rows.length;
}

/** 某些文章的所有译文重建索引（标签变化后调用） */
export async function reindexTranslationsOf(db: Executor, postIds: number[]): Promise<number> {
  if (postIds.length === 0) return 0;
  return reindexTranslations(db, inArray(postTranslations.postId, postIds));
}


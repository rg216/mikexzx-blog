import type { AdminTag, tagInputSchema, tagUpdateInputSchema } from "@blog/shared";
import { and, asc, count, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client.ts";
import { posts, postTags, tags } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import type { Executor } from "./post-common.ts";
import { reindexPostsAndTranslations } from "./posts.ts";

/*
 * 标签的集中管理。文章只能引用这里已有的标签（见 posts.ts 的 resolveTags）。
 * 标签名是搜索索引的一部分（权重 B，原文和译文都有），也显示在前台每种语言的文章上：改名、合并、删除之后，
 * 要重建用到它的文章的索引，并告诉调用方哪些已发布文章的页面需要刷新。
 */

type CreateData = z.output<typeof tagInputSchema>;
type UpdateData = z.output<typeof tagUpdateInputSchema>;

/** 一次修改的结果：publishedSlugs 是内容受影响的已发布文章，调用方据此刷新前台缓存 */
export type TagChange<T> = { result: T; publishedSlugs: string[] };

async function selectTags(db: Executor, where?: SQL): Promise<AdminTag[]> {
  const postCount = count(postTags.postId);
  return db
    .select({
      id: tags.id,
      slug: tags.slug,
      name: tags.name,
      postCount,
      publishedCount: sql<number>`count(*) filter (where ${posts.status} = 'published')`.mapWith(Number),
    })
    .from(tags)
    .leftJoin(postTags, eq(postTags.tagId, tags.id))
    .leftJoin(posts, eq(posts.id, postTags.postId))
    .where(where)
    .groupBy(tags.id)
    .orderBy(desc(postCount), asc(tags.name));
}

async function selectTag(db: Executor, id: number): Promise<AdminTag> {
  const [tag] = await selectTags(db, eq(tags.id, id));
  if (!tag) throw new Error(`tag ${id} not found`);
  return tag;
}

/** 后台列表：全部标签（含没有文章用的），按使用次数排序 */
export function listAdminTags(db: Db): Promise<AdminTag[]> {
  return selectTags(db);
}

/** 用到这些标签的文章：id 用来重建索引，已发布的 slug 用来刷新页面 */
async function postsUsing(db: Executor, tagIds: number[]): Promise<{ ids: number[]; publishedSlugs: string[] }> {
  const rows = await db
    .selectDistinct({ id: posts.id, slug: posts.slug, status: posts.status })
    .from(posts)
    .innerJoin(postTags, eq(postTags.postId, posts.id))
    .where(inArray(postTags.tagId, tagIds));
  return { ids: rows.map((r) => r.id), publishedSlugs: rows.filter((r) => r.status === "published").map((r) => r.slug) };
}

/** 标签名在原文和每篇译文的搜索索引里（标签不翻译，所有语言共用） */
const reindex = reindexPostsAndTranslations;

/** slug 或名称重复由数据库的唯一约束拒绝（409，见 create-app.ts） */
export async function createTag(db: Db, data: CreateData): Promise<AdminTag> {
  const [row] = await db.insert(tags).values(data).returning({ id: tags.id });
  if (!row) throw new Error("insert returned no row");
  return selectTag(db, row.id);
}

/** 改名 / 改 slug；不存在返回 null。只改 slug 不影响搜索索引，但前台数据里也带着 slug，照样刷新页面 */
export async function updateTag(db: Db, id: number, data: UpdateData): Promise<TagChange<AdminTag> | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(tags).where(eq(tags.id, id)).for("update");
    if (!current) return null;
    await tx.update(tags).set(data).where(eq(tags.id, id));

    const affected = await postsUsing(tx, [id]);
    if (data.name !== undefined && data.name !== current.name) await reindex(tx, affected.ids);
    const changed = (data.name ?? current.name) !== current.name || (data.slug ?? current.slug) !== current.slug;
    return { result: await selectTag(tx, id), publishedSlugs: changed ? affected.publishedSlugs : [] };
  });
}

/** 删除标签，用到它的文章去掉这个标签（post_tags 外键级联）；不存在返回 null */
export async function deleteTag(db: Db, id: number): Promise<TagChange<null> | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.id, id)).for("update");
    if (!current) return null;
    const affected = await postsUsing(tx, [id]);
    await tx.delete(tags).where(eq(tags.id, id));
    await reindex(tx, affected.ids);
    return { result: null, publishedSlugs: affected.publishedSlugs };
  });
}

/**
 * 把标签 id 合并进 into：用到 id 的文章改用 into（保持它在文章里的位置），已经同时有两者的只去掉 id，最后删除 id。
 * 用来收拾意思重复的标签。
 */
export async function mergeTag(db: Db, id: number, into: number): Promise<TagChange<AdminTag>> {
  if (id === into) throw new HttpError(400, "validation_error", "不能把标签合并到它自己");
  return db.transaction(async (tx) => {
    const found = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, [id, into])).for("update");
    if (!found.some((t) => t.id === id)) throw new HttpError(404, "not_found", "标签不存在");
    if (!found.some((t) => t.id === into)) throw new HttpError(404, "not_found", "要合并到的标签不存在");

    const affected = await postsUsing(tx, [id]);
    const hasTarget = tx.select({ postId: postTags.postId }).from(postTags).where(eq(postTags.tagId, into));
    await tx.delete(postTags).where(and(eq(postTags.tagId, id), inArray(postTags.postId, hasTarget)));
    await tx.update(postTags).set({ tagId: into }).where(eq(postTags.tagId, id));
    await tx.delete(tags).where(eq(tags.id, id));
    await reindex(tx, affected.ids);
    return { result: await selectTag(tx, into), publishedSlugs: affected.publishedSlugs };
  });
}

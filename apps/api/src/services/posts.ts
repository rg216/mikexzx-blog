import {
  type AdminPost,
  defaultSourceLocale,
  type AdminTranslationSummary,
  type ListPostsQuery,
  type Locale,
  localeInfo,
  locales,
  type Post,
  type postCreateInputSchema,
  type PostSummary,
  type PostSummaryPage,
  type PostStatus,
  type postUpdateInputSchema,
  type PublicPost,
  type Tag,
  type TagWithCount,
} from "@blog/shared";
import { and, asc, count, desc, eq, getTableColumns, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client.ts";
import { posts, postTags, postTranslations, tags } from "../db/schema.ts";
import { type Cursor, encodeCursor } from "../lib/cursor.ts";
import { excerptFromMarkdown } from "../lib/excerpt.ts";
import { sourceHash } from "../lib/source-hash.ts";
import { imageMetaForPost, syncPostImages } from "./images.ts";
import { type Executor, searchVectorOf, tagsByPostId } from "./post-common.ts";
import { isOutdated, reindexTranslationsOf, translationColumns, translationSummariesByPostId } from "./translations.ts";


// 服务层接收的是"校验之后"的数据（zod 的 output 类型，默认值已填好）
type CreateData = z.output<typeof postCreateInputSchema>;
type UpdateData = z.output<typeof postUpdateInputSchema>;

// 搜索索引只在搜索时用到，其他查询都不读它（可能有几百 KB）
const { searchVector: _searchVector, ...postColumns } = getTableColumns(posts);
type PostRow = Omit<typeof posts.$inferSelect, "searchVector">;

/** 一篇文章某个语言版本的内容（原文或译文） */
type Version = { locale: Locale; title: string; excerpt: string };

/** 原文的摘要长度按原文语言取 */
const excerptOf = (contentMd: string, locale: Locale) => excerptFromMarkdown(contentMd, localeInfo[locale].excerptLength);

function toSummary(row: { slug: string; status: PostStatus; publishedAt: Date | null }, version: Version, postTagList: Tag[]): PostSummary {
  return {
    slug: row.slug,
    title: version.title,
    excerpt: version.excerpt,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    tags: postTagList,
    locale: version.locale,
  };
}

/** 原文作为一个语言版本 */
const originalOf = (row: PostRow): Version => ({ locale: row.sourceLocale, title: row.title, excerpt: row.excerpt });

function toAdminPost(row: PostRow, postTagList: Tag[], imageMeta: Post["images"], translations: AdminTranslationSummary[]): AdminPost {
  return {
    ...toSummary(row, originalOf(row), postTagList),
    contentMd: row.contentMd,
    images: imageMeta,
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sourceLocale: row.sourceLocale,
    sourceHash: sourceHash(row),
    translations,
  };
}

/*
 * 某种语言能看到哪些文章、看到的是哪个版本：
 * - 原文就是这种语言 → 原文；
 * - 否则有这种语言的译文 → 译文；
 * - 都没有 → 不出现在这种语言的列表里（避免各语言列表里都是同样的原文，搜索引擎视为重复内容）。
 * 连接条件里排除"原文就是这种语言"：即使库里意外有一篇与原文同语言的译文，也总是显示原文。
 */
function translationJoin(locale: Locale) {
  return and(eq(postTranslations.postId, posts.id), eq(postTranslations.locale, locale), ne(posts.sourceLocale, locale));
}
const visibleIn = (locale: Locale) => or(eq(posts.sourceLocale, locale), sql`${postTranslations.postId} IS NOT NULL`);

// ---------- 公开 ----------

/** 某种语言可见的已发布文章，按发布时间倒序，游标分页。标题和摘要是该语言的版本。 */
export async function listPublishedPosts(
  db: Db,
  { limit, cursor, locale }: { limit: ListPostsQuery["limit"]; cursor: Cursor | null; locale: Locale },
): Promise<PostSummaryPage> {
  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      status: posts.status,
      publishedAt: posts.publishedAt,
      // 有译文用译文，否则（原文就是这种语言）用原文
      title: sql<string>`COALESCE(${postTranslations.title}, ${posts.title})`,
      excerpt: sql<string>`COALESCE(${postTranslations.excerpt}, ${posts.excerpt})`,
      locale: sql<Locale>`COALESCE(${postTranslations.locale}, ${posts.sourceLocale})`,
    })
    .from(posts)
    // 按主键 (post_id, locale) 逐篇查译文：沿 (published_at, id) 索引取前 limit + 1 篇时，每篇一次索引查找
    .leftJoin(postTranslations, translationJoin(locale))
    .where(
      and(
        eq(posts.status, "published"),
        visibleIn(locale),
        // 行值比较 (a, b) < (x, y)：一个条件表达"排在游标之后"，并且能直接利用 (published_at, id) 索引
        cursor ? sql`(${posts.publishedAt}, ${posts.id}) < (${cursor.publishedAt}, ${cursor.id})` : undefined,
      ),
    )
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    // 多取一条，用来判断是否还有下一页，省掉一次 count 查询
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const hasMore = rows.length > limit;
  const tagMap = await tagsByPostId(
    db,
    page.map((r) => r.id),
  );

  return {
    items: page.map((row) => toSummary(row, row, tagMap.get(row.id) ?? [])),
    nextCursor: hasMore && last?.publishedAt ? encodeCursor({ publishedAt: last.publishedAt, id: last.id }) : null,
  };
}

/**
 * 已发布文章的某个语言版本。没有该语言的译文时返回原文（locale 为原文语言、translation 为 null），
 * 前台据此显示"暂无译文"的提示——直接访问 /en/posts/<slug> 不会 404。
 */
export async function getPublishedPost(db: Db, slug: string, locale: Locale): Promise<PublicPost | null> {
  const [row] = await db
    .select(postColumns)
    .from(posts)
    .where(and(eq(posts.slug, slug), eq(posts.status, "published")));
  if (!row) return null;

  const wantsTranslation = locale !== row.sourceLocale;
  const [tagMap, imageMeta, translated, translationLocales] = await Promise.all([
    tagsByPostId(db, [row.id]),
    // 图片引用关系是原文和所有译文的并集，对哪个语言版本都适用
    imageMetaForPost(db, row.id),
    wantsTranslation
      ? db
          .select(translationColumns)
          .from(postTranslations)
          .where(and(eq(postTranslations.postId, row.id), eq(postTranslations.locale, locale)))
          .then(([t]) => t)
      : undefined,
    db.select({ locale: postTranslations.locale }).from(postTranslations).where(eq(postTranslations.postId, row.id)),
  ]);

  const available = new Set<Locale>([row.sourceLocale, ...translationLocales.map((t) => t.locale)]);
  const base = { sourceLocale: row.sourceLocale, availableLocales: locales.filter((l) => available.has(l)), images: imageMeta };
  const postTagList = tagMap.get(row.id) ?? [];

  if (!translated) {
    return { ...toSummary(row, originalOf(row), postTagList), contentMd: row.contentMd, ...base, translation: null };
  }
  return {
    ...toSummary(row, translated, postTagList),
    contentMd: translated.contentMd,
    ...base,
    translation: {
      origin: translated.origin,
      translatedAt: translated.translatedAt.toISOString(),
      outdated: isOutdated(translated.sourceHash, sourceHash(row)),
    },
  };
}

/** 已发布文章的 id（阅读计数用）；不存在或是草稿返回 null。 */
export async function getPublishedPostId(db: Db, slug: string): Promise<number | null> {
  const [row] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.slug, slug), eq(posts.status, "published")));
  return row?.id ?? null;
}

/** 某种语言可见的已发布文章用到的标签及篇数；只被草稿或该语言看不到的文章用到的标签不出现。 */
export async function listTags(db: Db, locale: Locale): Promise<TagWithCount[]> {
  const postCount = count(posts.id);
  return db
    .select({ slug: tags.slug, name: tags.name, count: postCount })
    .from(tags)
    .innerJoin(postTags, eq(postTags.tagId, tags.id))
    .innerJoin(posts, and(eq(posts.id, postTags.postId), eq(posts.status, "published")))
    .leftJoin(postTranslations, translationJoin(locale))
    .where(visibleIn(locale))
    .groupBy(tags.id)
    .orderBy(desc(postCount), asc(tags.name));
}

// ---------- 管理 ----------

/**
 * 后台的文章查询：标签、译文概要各一次查询，不随文章数增加。
 * db 可能是事务（写入后读回），同一个事务连接上的查询只能一条接一条地发（并发调用 client.query() 已被 pg 弃用，pg 9 会直接报错），
 * 所以这里不用 Promise.all
 */
async function toAdminPosts(db: Executor, rows: PostRow[], imageMetaOf: (row: PostRow) => Promise<Post["images"]>): Promise<AdminPost[]> {
  const ids = rows.map((r) => r.id);
  const tagMap = await tagsByPostId(db, ids);
  const translationMap = await translationSummariesByPostId(db, new Map(rows.map((r) => [r.id, sourceHash(r)])));
  // 只有 getPostById（单篇）传入会查库的 imageMetaOf，逐篇查没有额外代价
  const imageMetas: Post["images"][] = [];
  for (const row of rows) imageMetas.push(await imageMetaOf(row));
  return rows.map((row, i) => toAdminPost(row, tagMap.get(row.id) ?? [], imageMetas[i] ?? {}, translationMap.get(row.id) ?? []));
}

export async function listAllPosts(db: Db): Promise<AdminPost[]> {
  const rows = await db.select(postColumns).from(posts).orderBy(desc(posts.updatedAt), desc(posts.id));
  // 列表不渲染正文，不需要图片信息
  return toAdminPosts(db, rows, async () => ({}));
}

export async function getPostById(db: Executor, id: number): Promise<AdminPost | null> {
  const [row] = await db.select(postColumns).from(posts).where(eq(posts.id, id));
  if (!row) return null;
  const [post] = await toAdminPosts(db, [row], (r) => imageMetaForPost(db, r.id));
  return post ?? null;
}

/** 同一 slug 只保留第一次出现的。注意不能用 new Map(entries)：重复 key 会被后面的值覆盖 */
function uniqueTags(postTagList: Tag[]): Tag[] {
  const bySlug = new Map<string, Tag>();
  for (const tag of postTagList) if (!bySlug.has(tag.slug)) bySlug.set(tag.slug, tag);
  return [...bySlug.values()];
}

/**
 * 用文章的标签列表整体替换旧的关联；标签本身按 slug upsert（同 slug 以最新名称为准）。
 * 标签改名会影响所有用到它的文章的搜索索引，返回这些"其他文章"的 id，由调用方重建索引。
 */
async function replaceTags(tx: Executor, postId: number, postTagList: Tag[]): Promise<number[]> {
  const unique = uniqueTags(postTagList);

  await tx.delete(postTags).where(eq(postTags.postId, postId));
  if (unique.length === 0) return [];

  const before = await tx
    .select({ id: tags.id, slug: tags.slug, name: tags.name })
    .from(tags)
    .where(
      inArray(
        tags.slug,
        unique.map((t) => t.slug),
      ),
    );
  const nameBySlug = new Map(unique.map((t) => [t.slug, t.name]));
  const renamedIds = before.filter((t) => nameBySlug.get(t.slug) !== t.name).map((t) => t.id);

  const saved = await tx
    .insert(tags)
    .values(unique)
    .onConflictDoUpdate({ target: tags.slug, set: { name: sql`excluded.name` } })
    .returning({ id: tags.id, slug: tags.slug });
  const idBySlug = new Map(saved.map((t) => [t.slug, t.id]));

  await tx.insert(postTags).values(
    unique.map((tag, position) => {
      const tagId = idBySlug.get(tag.slug);
      if (tagId === undefined) throw new Error(`upsert did not return tag "${tag.slug}"`);
      return { postId, tagId, position };
    }),
  );

  if (renamedIds.length === 0) return [];
  const affected = await tx
    .selectDistinct({ postId: postTags.postId })
    .from(postTags)
    .where(and(inArray(postTags.tagId, renamedIds), ne(postTags.postId, postId)));
  return affected.map((r) => r.postId);
}

/**
 * 重建符合条件的文章的搜索索引，返回处理的篇数。用于：标签改名影响到的其他文章；迁移后补齐 search_vector 为 NULL 的文章。
 * 不改 updated_at——这不是作者的编辑。
 */
export async function reindexPosts(db: Executor, where: SQL): Promise<number> {
  const rows = await db.select({ id: posts.id, title: posts.title, contentMd: posts.contentMd }).from(posts).where(where);
  const tagMap = await tagsByPostId(
    db,
    rows.map((r) => r.id),
  );
  for (const row of rows) {
    await db
      .update(posts)
      .set({ searchVector: searchVectorOf({ ...row, tags: tagMap.get(row.id) ?? [] }), updatedAt: sql`${posts.updatedAt}` })
      .where(eq(posts.id, row.id));
  }
  return rows.length;
}

/** 标签改名影响到的其他文章：原文和译文的索引都要重建 */
async function reindexForRenamedTags(tx: Executor, postIds: number[]): Promise<void> {
  if (postIds.length === 0) return;
  await reindexPosts(tx, inArray(posts.id, postIds));
  await reindexTranslationsOf(tx, postIds);
}

export async function createPost(db: Db, data: CreateData): Promise<AdminPost> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(posts)
      .values({
        slug: data.slug,
        title: data.title,
        contentMd: data.contentMd,
        // 新文章的原文语言目前固定为默认值（posts.source_locale 的列默认值），摘要长度按它取
        excerpt: excerptOf(data.contentMd, defaultSourceLocale),
        searchVector: searchVectorOf({ title: data.title, contentMd: data.contentMd, tags: uniqueTags(data.tags) }),
        status: data.status,
        // 显式给了就用（导入旧文章）；否则发布时取当前时间，草稿为 null
        publishedAt: data.publishedAt
          ? new Date(data.publishedAt)
          : data.status === "published"
            ? new Date()
            : null,
      })
      .returning({ id: posts.id });
    if (!row) throw new Error("insert returned no row");

    const affected = await replaceTags(tx, row.id, data.tags);
    await reindexForRenamedTags(tx, affected);
    await syncPostImages(tx, row.id);
    const created = await getPostById(tx, row.id);
    if (!created) throw new Error("created post not found");
    return created;
  });
}

export type PublicState = { slug: string; status: AdminPost["status"] };

/** 部分更新；文章不存在返回 null。同时返回修改前的 slug / 状态（判断前台哪些缓存要失效）。 */
export async function updatePost(
  db: Db,
  id: number,
  data: UpdateData,
): Promise<{ post: AdminPost; before: PublicState } | null> {
  return db.transaction(async (tx) => {
    // FOR UPDATE 锁住这一行：两个请求同时"首次发布"时，只有一个会写入发布时间
    const [current] = await tx.select(postColumns).from(posts).where(eq(posts.id, id)).for("update");
    if (!current) return null;

    const { tags: newTags, publishedAt, contentMd, ...fields } = data;
    const firstPublish = fields.status === "published" && current.publishedAt === null && publishedAt === undefined;

    // 标题、正文、标签任何一个变了都要重建索引；没传的字段用当前值
    const searchVector =
      fields.title !== undefined || contentMd !== undefined || newTags !== undefined
        ? searchVectorOf({
            title: fields.title ?? current.title,
            contentMd: contentMd ?? current.contentMd,
            tags: newTags !== undefined ? uniqueTags(newTags) : ((await tagsByPostId(tx, [id])).get(id) ?? []),
          })
        : undefined;

    await tx
      .update(posts)
      .set({
        ...fields,
        ...(contentMd !== undefined && { contentMd, excerpt: excerptOf(contentMd, current.sourceLocale) }),
        ...(publishedAt !== undefined && { publishedAt: publishedAt ? new Date(publishedAt) : null }),
        ...(firstPublish && { publishedAt: new Date() }),
        ...(searchVector !== undefined && { searchVector }),
        // 只改标签时也要刷新更新时间
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));

    const affected = newTags !== undefined ? await replaceTags(tx, id, newTags) : [];
    await reindexForRenamedTags(tx, affected);
    // 标签也在译文的搜索索引里（B 权重）：这篇文章的标签变了，它的译文也要重建
    if (newTags !== undefined) await reindexTranslationsOf(tx, [id]);
    if (contentMd !== undefined) await syncPostImages(tx, id);
    const post = await getPostById(tx, id);
    if (!post) throw new Error("updated post not found");
    return { post, before: { slug: current.slug, status: current.status } };
  });
}

/** 删除文章（关联的 post_tags 由外键级联删除）。返回被删文章的 slug / 状态，不存在返回 null。 */
export async function deletePost(db: Db, id: number): Promise<PublicState | null> {
  const [deleted] = await db.delete(posts).where(eq(posts.id, id)).returning({ slug: posts.slug, status: posts.status });
  return deleted ?? null;
}

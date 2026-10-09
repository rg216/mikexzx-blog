import type {
  AdminPost,
  ListPostsQuery,
  Post,
  postCreateInputSchema,
  PostSummary,
  PostSummaryPage,
  postUpdateInputSchema,
  Tag,
  TagWithCount,
} from "@blog/shared";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client.ts";
import { posts, postTags, tags } from "../db/schema.ts";
import { type Cursor, encodeCursor } from "../lib/cursor.ts";
import { excerptFromMarkdown } from "../lib/excerpt.ts";

// 服务层接收的是"校验之后"的数据（zod 的 output 类型，默认值已填好）
type CreateData = z.output<typeof postCreateInputSchema>;
type UpdateData = z.output<typeof postUpdateInputSchema>;

/** db 本身或事务对象，两者的查询 API 相同 */
type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

type PostRow = typeof posts.$inferSelect;
type SummaryRow = Omit<PostRow, "contentMd">;

// 列表不需要正文：只选需要的列，不从数据库搬运全文
const summaryColumns = {
  id: posts.id,
  slug: posts.slug,
  title: posts.title,
  excerpt: posts.excerpt,
  status: posts.status,
  publishedAt: posts.publishedAt,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
};

/** 一次查出多篇文章的标签（避免每篇文章各查一次的 N+1 问题），按作者填写的顺序。 */
async function tagsByPostId(db: Executor, postIds: number[]): Promise<Map<number, Tag[]>> {
  const result = new Map<number, Tag[]>(postIds.map((id) => [id, []]));
  if (postIds.length === 0) return result;

  const rows = await db
    .select({ postId: postTags.postId, slug: tags.slug, name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(tags.id, postTags.tagId))
    .where(inArray(postTags.postId, postIds))
    .orderBy(asc(postTags.position));

  for (const { postId, ...tag } of rows) result.get(postId)?.push(tag);
  return result;
}

function toSummary(row: SummaryRow, postTagList: Tag[]): PostSummary {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    tags: postTagList,
  };
}

function toPost(row: PostRow, postTagList: Tag[]): Post {
  return { ...toSummary(row, postTagList), contentMd: row.contentMd };
}

function toAdminPost(row: PostRow, postTagList: Tag[]): AdminPost {
  return {
    ...toPost(row, postTagList),
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------- 公开 ----------

/** 已发布文章，按发布时间倒序，游标分页。 */
export async function listPublishedPosts(
  db: Db,
  { limit, cursor }: { limit: ListPostsQuery["limit"]; cursor: Cursor | null },
): Promise<PostSummaryPage> {
  const rows = await db
    .select(summaryColumns)
    .from(posts)
    .where(
      and(
        eq(posts.status, "published"),
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
    items: page.map((row) => toSummary(row, tagMap.get(row.id) ?? [])),
    nextCursor: hasMore && last?.publishedAt ? encodeCursor({ publishedAt: last.publishedAt, id: last.id }) : null,
  };
}

export async function getPublishedPost(db: Db, slug: string): Promise<Post | null> {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.slug, slug), eq(posts.status, "published")));
  if (!row) return null;
  const tagMap = await tagsByPostId(db, [row.id]);
  return toPost(row, tagMap.get(row.id) ?? []);
}

/** 已发布文章用到的标签及篇数；只被草稿用到的标签不出现。 */
export async function listTags(db: Db): Promise<TagWithCount[]> {
  const postCount = count(posts.id);
  return db
    .select({ slug: tags.slug, name: tags.name, count: postCount })
    .from(tags)
    .innerJoin(postTags, eq(postTags.tagId, tags.id))
    .innerJoin(posts, and(eq(posts.id, postTags.postId), eq(posts.status, "published")))
    .groupBy(tags.id)
    .orderBy(desc(postCount), asc(tags.name));
}

// ---------- 管理 ----------

export async function listAllPosts(db: Db): Promise<AdminPost[]> {
  const rows = await db.select().from(posts).orderBy(desc(posts.updatedAt), desc(posts.id));
  const tagMap = await tagsByPostId(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toAdminPost(row, tagMap.get(row.id) ?? []));
}

export async function getPostById(db: Executor, id: number): Promise<AdminPost | null> {
  const [row] = await db.select().from(posts).where(eq(posts.id, id));
  if (!row) return null;
  const tagMap = await tagsByPostId(db, [row.id]);
  return toAdminPost(row, tagMap.get(row.id) ?? []);
}

/** 用文章的标签列表整体替换旧的关联；标签本身按 slug upsert（同 slug 以最新名称为准）。 */
async function replaceTags(tx: Executor, postId: number, postTagList: Tag[]): Promise<void> {
  // 同一 slug 只保留第一次出现的。注意不能用 new Map(entries)：重复 key 会被后面的值覆盖
  const bySlug = new Map<string, Tag>();
  for (const tag of postTagList) if (!bySlug.has(tag.slug)) bySlug.set(tag.slug, tag);
  const unique = [...bySlug.values()];

  await tx.delete(postTags).where(eq(postTags.postId, postId));
  if (unique.length === 0) return;

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
}

export async function createPost(db: Db, data: CreateData): Promise<AdminPost> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(posts)
      .values({
        slug: data.slug,
        title: data.title,
        contentMd: data.contentMd,
        excerpt: excerptFromMarkdown(data.contentMd),
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

    await replaceTags(tx, row.id, data.tags);
    const created = await getPostById(tx, row.id);
    if (!created) throw new Error("created post not found");
    return created;
  });
}

/** 部分更新；文章不存在返回 null。 */
export async function updatePost(db: Db, id: number, data: UpdateData): Promise<AdminPost | null> {
  return db.transaction(async (tx) => {
    // FOR UPDATE 锁住这一行：两个请求同时"首次发布"时，只有一个会写入发布时间
    const [current] = await tx.select().from(posts).where(eq(posts.id, id)).for("update");
    if (!current) return null;

    const { tags: newTags, publishedAt, contentMd, ...fields } = data;
    const firstPublish = fields.status === "published" && current.publishedAt === null && publishedAt === undefined;

    await tx
      .update(posts)
      .set({
        ...fields,
        ...(contentMd !== undefined && { contentMd, excerpt: excerptFromMarkdown(contentMd) }),
        ...(publishedAt !== undefined && { publishedAt: publishedAt ? new Date(publishedAt) : null }),
        ...(firstPublish && { publishedAt: new Date() }),
        // 只改标签时也要刷新更新时间
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));

    if (newTags !== undefined) await replaceTags(tx, id, newTags);
    return getPostById(tx, id);
  });
}

/** 删除文章（关联的 post_tags 由外键级联删除）。返回是否真的删除了。 */
export async function deletePost(db: Db, id: number): Promise<boolean> {
  const deleted = await db.delete(posts).where(eq(posts.id, id)).returning({ id: posts.id });
  return deleted.length > 0;
}

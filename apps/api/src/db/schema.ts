import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// 列名由 casing: "snake_case" 自动转换：contentMd → content_md。

// 时间戳统一精确到毫秒：PostgreSQL 默认是微秒，而 JS 的 Date 只有毫秒。
// 游标分页要拿 JS 里的时间和库里的比较，精度不一致会导致漏掉或重复文章。
const timestamptz = () => timestamp({ withTimezone: true, precision: 3 });

export const postStatus = pgEnum("post_status", ["draft", "published"]);

export const posts = pgTable(
  "posts",
  {
    // 自增整数作内部主键：只在管理接口里出现；公开接口一律用 slug，不暴露 id。
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    slug: text().notNull().unique(),
    title: text().notNull(),
    contentMd: text().notNull(),
    // 写入时生成并存储，列表查询不用再解析 Markdown
    excerpt: text().notNull(),
    status: postStatus().notNull().default("draft"),
    publishedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // 不变量写在数据库里：即使 API 有 bug，也存不进"已发布但没有发布时间"的文章
    check("posts_published_has_date", sql`${t.status} = 'draft' OR ${t.publishedAt} IS NOT NULL`),
    // 公开列表的查询条件 + 排序 + 游标，正好对应这个部分索引
    index("posts_published_feed_idx")
      .on(t.publishedAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'published'`),
  ],
);

export const tags = pgTable("tags", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  slug: text().notNull().unique(),
  name: text().notNull(),
});

export const postTags = pgTable(
  "post_tags",
  {
    postId: integer()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: integer()
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    /** 标签在这篇文章里的顺序（作者填写的顺序） */
    position: integer().notNull(),
  },
  // 复合主键同时防止重复关联；(post_id, tag_id) 的顺序也服务于"按文章查标签"
  (t) => [primaryKey({ columns: [t.postId, t.tagId] }), index("post_tags_tag_id_idx").on(t.tagId)],
);

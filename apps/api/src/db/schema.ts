import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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

// ---------- 鉴权（v2）：只用 Passkey，没有密码 ----------

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  displayName: text().notNull(),
  // WebAuthn 的 user handle：随机字节（base64url）。规范要求它不能含可识别个人的信息，所以不用 id 或邮箱
  webauthnUserId: text().notNull().unique(),
  createdAt: timestamptz().notNull().defaultNow(),
});

export const passkeys = pgTable(
  "passkeys",
  {
    // 凭证 ID（base64url），由认证器生成，全局唯一
    id: text().primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // COSE 格式的公钥（base64url）。只存公钥：服务器泄露也无法用它登录
    publicKey: text().notNull(),
    // 签名计数器是无符号 32 位整数，超出 integer 范围，用 bigint
    counter: bigint({ mode: "number" }).notNull(),
    transports: text().array().notNull().default(sql`'{}'::text[]`),
    deviceType: text({ enum: ["singleDevice", "multiDevice"] }).notNull(),
    backedUp: boolean().notNull(),
    name: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    lastUsedAt: timestamptz(),
  },
  (t) => [index("passkeys_user_id_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    // 存 SHA-256(token)，不存 token 本身：数据库泄露时拿到的哈希无法当作 cookie 使用
    id: text().primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamptz().notNull().defaultNow(),
    // 绝对过期时间：无论是否活跃，到点必须重新登录
    expiresAt: timestamptz().notNull(),
    // 最近活跃时间：用于闲置超时
    lastSeenAt: timestamptz().notNull().defaultNow(),
    userAgent: text(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const challengeKind = pgEnum("challenge_kind", ["registration", "authentication"]);

/** WebAuthn 一次性 challenge：生成选项时写入，验证时取出并删除（防重放），5 分钟过期 */
export const authChallenges = pgTable("auth_challenges", {
  // 随机 id，放在短期 httpOnly cookie 里，把"这次验证"和"那次生成的 challenge"对应起来
  id: text().primaryKey(),
  challenge: text().notNull(),
  kind: challengeKind().notNull(),
  // 注册时预先生成的 user handle（首次设置时用户还不存在）
  webauthnUserId: text(),
  // 已登录用户添加新 Passkey 时记录是谁
  userId: integer().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamptz().notNull(),
});

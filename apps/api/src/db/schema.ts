import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { bigint, boolean, check, customType, date, index, integer, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// 列名由 casing: "snake_case" 自动转换：contentMd → content_md。

// 时间戳统一精确到毫秒：PostgreSQL 默认是微秒，而 JS 的 Date 只有毫秒。
// 游标分页要拿 JS 里的时间和库里的比较，精度不一致会导致漏掉或重复文章。
const timestamptz = () => timestamp({ withTimezone: true, precision: 3 });

// Drizzle 没有内置 tsvector 类型。读写都用文本形式（'lexeme':1A …），由 lib/search-text.ts 生成
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

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
    // 全文搜索索引（v4b），写入时由 API 生成。NULL 表示待生成：迁移脚本跑完迁移后会补齐，
    // 所以改了分词规则时，写一个 "UPDATE posts SET search_vector = NULL" 的迁移即可全部重建
    searchVector: tsvector(),
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
    // GIN 倒排索引：按词条找文章。只有已发布文章会被搜索，所以也做成部分索引
    index("posts_search_idx")
      .using("gin", t.searchVector)
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

/**
 * 每篇文章每天的阅读数（v4）。实时计数在 Redis 里，每天由定时任务把前一天的数字写到这里：
 * 一是保留历史（以后可以画趋势），二是 Redis 数据丢了也能从这里重算总数。
 */
export const postViews = pgTable(
  "post_views",
  {
    postId: integer()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    // 按站点时区（Asia/Shanghai）划分的日期
    day: date({ mode: "string" }).notNull(),
    views: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.day] })],
);

/**
 * 上传的图片（v2c）。文件在对象存储里，这里记录元数据。
 * 签发上传 URL 时就插入一行（confirmed_at 为 NULL），浏览器上传完、API 核对过对象后才填 confirmed_at。
 * 一直没确认的（上传失败、中途关掉页面）由每天的定时任务连同存储里的文件一起清理——
 * 先记账再上传，存储里就不会出现"数据库不知道的孤儿文件"，清理时也不用遍历整个存储桶。
 */
export const images = pgTable(
  "images",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // 对象存储里的 key：images/2026/10/<随机串>.webp。随机串不可猜，也不会和已有文件重名
    key: text().notNull().unique(),
    contentType: text().notNull(),
    // 申请上传时声明的字节数；确认时与存储里的实际大小比对
    size: integer().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    confirmedAt: timestamptz(),
  },
  (t) => [index("images_pending_idx").on(t.createdAt).where(sql`${t.confirmedAt} IS NULL`)],
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

// ---------- 评论（v4c）：评论者用 GitHub 登录，与管理员的 Passkey 体系完全分开 ----------

export const commenterTrust = pgEnum("commenter_trust", ["default", "trusted", "blocked"]);

/** 评论者（GitHub 用户）。资料在每次登录时从 GitHub 更新；管理员也可以按用户名预先把人加进白名单 */
export const commenters = pgTable("commenters", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  // GitHub 的数字 id 永不改变；login（用户名）可以改，所以不用它做唯一标识
  githubId: bigint({ mode: "number" }).notNull().unique(),
  login: text().notNull(),
  name: text(),
  avatarUrl: text().notNull(),
  trust: commenterTrust().notNull().default("default"),
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * 评论者的登录状态。和管理员的 sessions 分表、分 cookie：
 * 评论者 session 被盗最多冒名发评论，管理员 session 被盗能改全站——两者不能有任何混用的可能。
 */
export const commenterSessions = pgTable(
  "commenter_sessions",
  {
    // 同 sessions：只存 SHA-256(token)
    id: text().primaryKey(),
    commenterId: integer()
      .notNull()
      .references(() => commenters.id, { onDelete: "cascade" }),
    createdAt: timestamptz().notNull().defaultNow(),
    expiresAt: timestamptz().notNull(),
    lastSeenAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index("commenter_sessions_commenter_id_idx").on(t.commenterId)],
);

/** OAuth 登录进行中的状态：state（防 CSRF）、PKCE 的 code_verifier、登录后回到哪里。一次性，10 分钟过期 */
export const oauthStates = pgTable("oauth_states", {
  // 即 OAuth 的 state 参数，同时放在浏览器的短期 cookie 里，回调时两者必须一致
  id: text().primaryKey(),
  codeVerifier: text().notNull(),
  returnTo: text().notNull(),
  expiresAt: timestamptz().notNull(),
});

export const commentStatus = pgEnum("comment_status", ["pending", "approved", "rejected"]);

/**
 * 评论。楼中楼只有两层：root_id 指向顶层评论（顶层评论自己为 NULL），parent_id 指向直接回复的那条。
 * 删除顶层评论连同整楼删除；删除楼里的某条回复，回复它的评论保留（只是不再显示"回复 @谁"）。
 */
export const comments = pgTable(
  "comments",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    postId: integer()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    commenterId: integer()
      .notNull()
      .references(() => commenters.id, { onDelete: "cascade" }),
    rootId: integer().references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    parentId: integer().references((): AnyPgColumn => comments.id, { onDelete: "set null" }),
    body: text().notNull(),
    status: commentStatus().notNull().default("pending"),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // 顶层评论不能有 parent
    check("comments_root_has_no_parent", sql`${t.rootId} IS NOT NULL OR ${t.parentId} IS NULL`),
    check("comments_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 5000`),
    // 文章页按时间列出评论
    index("comments_post_idx").on(t.postId, t.createdAt),
    // 后台的审核队列
    index("comments_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);


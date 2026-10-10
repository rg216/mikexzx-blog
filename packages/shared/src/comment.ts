import { z } from "zod";
import { slugSchema } from "./post.ts";

const isoDateTime = z.iso.datetime({ offset: true });

/**
 * 评论者的信任等级（管理员在后台设置）：
 *   default  每条评论都要审核
 *   trusted  白名单，评论直接显示
 *   blocked  不能再发评论
 */
export const commenterTrustSchema = z.enum(["default", "trusted", "blocked"]);
export type CommenterTrust = z.infer<typeof commenterTrustSchema>;

/** pending 待审核 / approved 已显示 / rejected 已拒绝（不显示，保留记录） */
export const commentStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

/** 公开展示的评论者信息（都来自 GitHub 公开资料） */
export const commentAuthorSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.url(),
});
export type CommentAuthor = z.infer<typeof commentAuthorSchema>;

export const COMMENT_MAX_LENGTH = 5000;

export const publicCommentSchema = z.object({
  id: z.int().positive(),
  author: commentAuthorSchema,
  /** Markdown 原文，由前端用评论专用的白名单渲染 */
  bodyMd: z.string(),
  createdAt: isoDateTime,
  /** 回复的是楼中楼里的另一条回复时，标出被回复的人（"回复 @xxx"）；直接回复楼主为 null */
  replyTo: commentAuthorSchema.pick({ login: true }).nullable(),
  /** 只有自己的评论可能是 pending（"审核中，仅你可见"），别人看到的都是 approved */
  status: z.enum(["pending", "approved"]),
});
export type PublicComment = z.infer<typeof publicCommentSchema>;

/** 楼中楼只有两层：顶层评论 + 它下面按时间排列的所有回复 */
export const commentThreadSchema = publicCommentSchema.extend({ replies: z.array(publicCommentSchema) });
export type CommentThread = z.infer<typeof commentThreadSchema>;

export const commentListSchema = z.object({
  threads: z.array(commentThreadSchema),
  /** 已显示（approved）的评论总数，不含自己待审核的 */
  count: z.int().nonnegative(),
});
export type CommentList = z.infer<typeof commentListSchema>;

export const commentCreateInputSchema = z.strictObject({
  body: z.string().trim().min(1, "评论不能为空").max(COMMENT_MAX_LENGTH, `评论不能超过 ${COMMENT_MAX_LENGTH} 个字符`),
  /** 回复哪条评论；不传表示发一条顶层评论 */
  parentId: z.int().positive().optional(),
});
export type CommentCreateInput = z.infer<typeof commentCreateInputSchema>;

/** 当前登录的评论者；未登录为 null。configured：服务端是否配置了 GitHub 登录 */
export const commenterMeSchema = z.object({
  configured: z.boolean(),
  commenter: commentAuthorSchema.extend({ trust: commenterTrustSchema }).nullable(),
});
export type CommenterMe = z.infer<typeof commenterMeSchema>;

// ---------- 管理 ----------

export const adminCommenterSchema = commentAuthorSchema.extend({
  id: z.int().positive(),
  githubId: z.int().positive(),
  trust: commenterTrustSchema,
  createdAt: isoDateTime,
});
export type AdminCommenter = z.infer<typeof adminCommenterSchema>;

export const adminCommentSchema = z.object({
  id: z.int().positive(),
  post: z.object({ slug: slugSchema, title: z.string() }),
  author: adminCommenterSchema,
  bodyMd: z.string(),
  status: commentStatusSchema,
  createdAt: isoDateTime,
  /** 回复的哪条评论（审核时需要上下文）：作者和纯文本摘要；顶层评论为 null */
  parent: z.object({ id: z.int().positive(), login: z.string(), excerpt: z.string() }).nullable(),
});
export type AdminComment = z.infer<typeof adminCommentSchema>;

export const adminCommentListQuerySchema = z.object({ status: commentStatusSchema.default("pending") });

export const commentModerationInputSchema = z.strictObject({ status: z.enum(["approved", "rejected"]) });
export const commenterTrustInputSchema = z.strictObject({ trust: commenterTrustSchema });

/** 按 GitHub 用户名直接加入白名单（对方还没来评论过也可以） */
export const commenterAddInputSchema = z.strictObject({
  login: z
    .string()
    .trim()
    .regex(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i, "不是有效的 GitHub 用户名"),
});

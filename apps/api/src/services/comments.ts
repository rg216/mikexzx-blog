import type { AdminComment, AdminCommenter, CommenterTrust, CommentList, CommentStatus, CommentThread, PublicComment } from "@blog/shared";
import { and, asc, count, desc, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { GitHubUser } from "../auth/github.ts";
import type { Commenter } from "../auth/commenter-sessions.ts";
import type { Db } from "../db/client.ts";
import { commenters, comments, posts } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { plainTextFromMarkdown } from "../lib/markdown-text.ts";

/** 一篇文章最多返回这么多条评论（个人博客远远到不了，只是给查询一个上限） */
const MAX_COMMENTS_PER_POST = 1000;
const ADMIN_LIST_LIMIT = 200;

const parent = alias(comments, "parent");
const parentAuthor = alias(commenters, "parent_author");

function toAuthor(row: Pick<Commenter, "login" | "name" | "avatarUrl">) {
  return { login: row.login, name: row.name, avatarUrl: row.avatarUrl };
}

// ---------- 公开 ----------

/**
 * 文章的评论，组织成两层的楼。可见范围：已通过的，加上当前评论者自己待审核的（"审核中，仅你可见"）。
 * 顶层评论不可见（待审核 / 被拒绝）时，整楼都不显示——楼里的回复脱离了上下文。
 */
export async function listPostComments(db: Db, postId: number, viewerId: number | null): Promise<CommentList> {
  const rows = await db
    .select({
      id: comments.id,
      rootId: comments.rootId,
      parentId: comments.parentId,
      body: comments.body,
      status: comments.status,
      createdAt: comments.createdAt,
      author: { login: commenters.login, name: commenters.name, avatarUrl: commenters.avatarUrl },
      parentLogin: parentAuthor.login,
    })
    .from(comments)
    .innerJoin(commenters, eq(commenters.id, comments.commenterId))
    .leftJoin(parent, eq(parent.id, comments.parentId))
    .leftJoin(parentAuthor, eq(parentAuthor.id, parent.commenterId))
    .where(
      and(
        eq(comments.postId, postId),
        viewerId === null
          ? eq(comments.status, "approved")
          : or(eq(comments.status, "approved"), and(eq(comments.status, "pending"), eq(comments.commenterId, viewerId))),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(MAX_COMMENTS_PER_POST);

  const threads = new Map<number, CommentThread>();
  for (const row of rows) {
    const comment: PublicComment = {
      id: row.id,
      author: row.author,
      bodyMd: row.body,
      createdAt: row.createdAt.toISOString(),
      // 直接回复楼主不用标注；回复楼里的其他人才显示"回复 @谁"
      replyTo: row.parentId !== null && row.parentId !== row.rootId && row.parentLogin ? { login: row.parentLogin } : null,
      status: row.status === "approved" ? "approved" : "pending",
    };
    if (row.rootId === null) threads.set(row.id, { ...comment, replies: [] });
    // 按时间排序，楼主一定先于回复出现；楼主不可见时这条回复被丢弃
    else threads.get(row.rootId)?.replies.push(comment);
  }

  const list = [...threads.values()];
  const visibleCount = list.reduce(
    (sum, thread) => sum + (thread.status === "approved" ? 1 : 0) + thread.replies.filter((r) => r.status === "approved").length,
    0,
  );
  return { threads: list, count: visibleCount };
}

/** 发评论。白名单用户直接显示，其他人进入审核队列，被拉黑的不能发。只能回复同一篇文章里已显示的评论 */
export async function createComment(
  db: Db,
  { postId, commenter, body, parentId }: { postId: number; commenter: Commenter; body: string; parentId?: number | undefined },
): Promise<PublicComment> {
  if (commenter.trust === "blocked") throw new HttpError(403, "forbidden", "你已被禁止评论");

  let rootId: number | null = null;
  let replyTo: { login: string } | null = null;
  if (parentId !== undefined) {
    const [target] = await db
      .select({ id: comments.id, rootId: comments.rootId, login: commenters.login })
      .from(comments)
      .innerJoin(commenters, eq(commenters.id, comments.commenterId))
      .where(and(eq(comments.id, parentId), eq(comments.postId, postId), eq(comments.status, "approved")));
    if (!target) throw new HttpError(404, "not_found", "要回复的评论不存在");
    rootId = target.rootId ?? target.id;
    if (target.rootId !== null) replyTo = { login: target.login };
  }

  const status = commenter.trust === "trusted" ? "approved" : "pending";
  const [row] = await db
    .insert(comments)
    .values({ postId, commenterId: commenter.id, rootId, parentId: parentId ?? null, body, status })
    .returning({ id: comments.id, createdAt: comments.createdAt });
  if (!row) throw new Error("insert returned no row");

  return { id: row.id, author: toAuthor(commenter), bodyMd: body, createdAt: row.createdAt.toISOString(), replyTo, status };
}

/** 登录时同步 GitHub 资料（用户名、头像可能改过），返回最新的评论者记录 */
export async function upsertCommenter(db: Db, user: GitHubUser, trust?: CommenterTrust): Promise<Commenter> {
  const profile = { login: user.login, name: user.name, avatarUrl: user.avatarUrl };
  const [row] = await db
    .insert(commenters)
    .values({ githubId: user.id, ...profile, ...(trust && { trust }) })
    .onConflictDoUpdate({ target: commenters.githubId, set: { ...profile, ...(trust && { trust }) } })
    .returning();
  if (!row) throw new Error("upsert returned no row");
  return row;
}

// ---------- 管理 ----------

/** 审核时引用的上下文：纯文本，最多 140 个字 */
function excerptOf(markdown: string): string {
  const text = Array.from(plainTextFromMarkdown(markdown));
  return text.length > 140 ? `${text.slice(0, 140).join("")}…` : text.join("");
}

function toAdminCommenter(row: Commenter): AdminCommenter {
  return { ...toAuthor(row), id: row.id, githubId: row.githubId, trust: row.trust, createdAt: row.createdAt.toISOString() };
}

/** 按状态列出评论；待审核的按时间正序（先来先审），其余倒序（最新的在前） */
export async function listAdminComments(db: Db, status: CommentStatus): Promise<AdminComment[]> {
  const rows = await db
    .select({
      comment: comments,
      post: { slug: posts.slug, title: posts.title },
      author: commenters,
      parent: { id: parent.id, body: parent.body },
      parentLogin: parentAuthor.login,
    })
    .from(comments)
    .innerJoin(posts, eq(posts.id, comments.postId))
    .innerJoin(commenters, eq(commenters.id, comments.commenterId))
    .leftJoin(parent, eq(parent.id, comments.parentId))
    .leftJoin(parentAuthor, eq(parentAuthor.id, parent.commenterId))
    .where(eq(comments.status, status))
    .orderBy(status === "pending" ? asc(comments.createdAt) : desc(comments.createdAt), desc(comments.id))
    .limit(ADMIN_LIST_LIMIT);

  return rows.map(({ comment, post, author, parent: p, parentLogin }) => ({
    id: comment.id,
    post,
    author: toAdminCommenter(author),
    bodyMd: comment.body,
    status: comment.status,
    createdAt: comment.createdAt.toISOString(),
    parent: p?.id && p.body !== null && parentLogin ? { id: p.id, login: parentLogin, excerpt: excerptOf(p.body) } : null,
  }));
}

export async function countPendingComments(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(comments).where(eq(comments.status, "pending"));
  return row?.n ?? 0;
}

/** 通过 / 拒绝一条评论；不存在返回 false */
export async function setCommentStatus(db: Db, id: number, status: "approved" | "rejected"): Promise<boolean> {
  const updated = await db.update(comments).set({ status }).where(eq(comments.id, id)).returning({ id: comments.id });
  return updated.length > 0;
}

/** 删除评论；顶层评论连同整楼删除（外键 ON DELETE CASCADE）。不存在返回 false */
export async function deleteComment(db: Db, id: number): Promise<boolean> {
  const deleted = await db.delete(comments).where(eq(comments.id, id)).returning({ id: comments.id });
  return deleted.length > 0;
}

export async function listCommenters(db: Db): Promise<AdminCommenter[]> {
  const rows = await db
    .select()
    .from(commenters)
    // 白名单在前，其次是被拉黑的，最后是普通评论者
    .orderBy(sql`CASE ${commenters.trust} WHEN 'trusted' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END`, asc(commenters.login));
  return rows.map(toAdminCommenter);
}

/**
 * 修改信任等级。加入白名单时顺便通过他所有待审核的评论（"批准并加入白名单"就是这么实现的）；
 * 拉黑时拒绝他所有待审核的评论。不存在返回 null。
 */
export async function setCommenterTrust(db: Db, id: number, trust: CommenterTrust): Promise<AdminCommenter | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(commenters).set({ trust }).where(eq(commenters.id, id)).returning();
    if (!row) return null;
    if (trust !== "default") {
      await tx
        .update(comments)
        .set({ status: trust === "trusted" ? "approved" : "rejected" })
        .where(and(eq(comments.commenterId, id), eq(comments.status, "pending")));
    }
    return toAdminCommenter(row);
  });
}

/** 按 GitHub 资料把人加进白名单（对方还没来评论过也可以） */
export async function addTrustedCommenter(db: Db, user: GitHubUser): Promise<AdminCommenter> {
  const row = await upsertCommenter(db, user);
  const trusted = await setCommenterTrust(db, row.id, "trusted");
  if (!trusted) throw new Error("commenter vanished");
  return trusted;
}

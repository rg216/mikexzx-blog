"use client";

import type { AdminComment, AdminCommenter, CommenterTrust, CommentStatus } from "@blog/shared";
import { ExternalLink, MessageSquare } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import { renderCommentMarkdown } from "@/lib/comment-markdown";
import styles from "./CommentModeration.module.css";

type Tab = CommentStatus | "commenters";

const tabOptions = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
  { value: "commenters", label: "评论者" },
] as const;

const trustOptions = [
  { value: "default", label: "需审核" },
  { value: "trusted", label: "白名单" },
  { value: "blocked", label: "拉黑" },
] as const;

const emptyText: Record<CommentStatus, string> = {
  pending: "没有待审核的评论。",
  approved: "还没有已通过的评论。",
  rejected: "没有被拒绝的评论。",
};

function messageOf(error: unknown): string {
  return error instanceof AdminApiError ? error.message : "出现了意外错误，请稍后重试";
}

/** 后台的评论审核：按状态分栏的评论列表 + 评论者（白名单 / 拉黑）管理 */
export function CommentModeration() {
  const [tab, setTab] = useState<Tab>("pending");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>评论</h1>
        <SegmentedControl label="分类" options={tabOptions} value={tab} onChange={setTab} />
      </header>
      {/* key：切换分栏时重新挂载，各自重新加载 */}
      {tab === "commenters" ? <CommenterList /> : <CommentList key={tab} status={tab} />}
    </div>
  );
}

type Load<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; items: T[] };

function CommentList({ status }: { status: CommentStatus }) {
  const [state, setState] = useState<Load<AdminComment>>({ kind: "loading" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AdminComment | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    adminApi.listComments(status).then(
      (items) => !ignore && setState({ kind: "ready", items }),
      (error: unknown) => !ignore && setState({ kind: "error", message: messageOf(error) }),
    );
    return () => {
      ignore = true;
    };
  }, [status, reloadKey]);

  /** 执行一个操作；成功后把受影响的评论从当前列表移走（它们已经不属于这个分栏了） */
  async function act(comment: AdminComment, action: () => Promise<unknown>, done: string, removeIds: (items: AdminComment[]) => number[]) {
    setBusyId(comment.id);
    setActionError(null);
    try {
      await action();
      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        const gone = new Set(removeIds(prev.items));
        return { ...prev, items: prev.items.filter((item) => !gone.has(item.id)) };
      });
      setAnnouncement(done);
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setBusyId(null);
    }
  }

  const only = (comment: AdminComment) => () => [comment.id];
  // 改信任等级会影响这个人在当前分栏里的所有待审核评论
  const byAuthor = (comment: AdminComment) => (items: AdminComment[]) =>
    items.filter((item) => item.author.id === comment.author.id && item.status === "pending").map((item) => item.id);

  if (state.kind === "loading") {
    return (
      <p className={styles.placeholder}>
        <Spinner />
        正在加载…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <Banner title="评论加载失败" action={<Button onClick={() => (setState({ kind: "loading" }), setReloadKey((k) => k + 1))}>重试</Button>}>
        {state.message}
      </Banner>
    );
  }

  return (
    <>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
      {actionError && (
        <Banner title="操作失败" className={styles.banner}>
          {actionError}
        </Banner>
      )}
      {state.items.length === 0 ? (
        <div className={styles.empty}>
          <MessageSquare className={styles.emptyIcon} aria-hidden="true" />
          <p>{emptyText[status]}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {state.items.map((comment) => {
            const busy = busyId === comment.id;
            const who = `@${comment.author.login}`;
            return (
              <li key={comment.id} className={styles.item}>
                <article className={styles.comment} aria-busy={busy}>
                  <header className={styles.meta}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- GitHub 头像，后台不需要优化 */}
                    <img className={styles.avatar} src={comment.author.avatarUrl} alt="" width={32} height={32} />
                    <a className={styles.author} href={`https://github.com/${comment.author.login}`} target="_blank" rel="noopener noreferrer">
                      {comment.author.name ?? comment.author.login}
                      <span className={styles.login}>{who}</span>
                    </a>
                    {comment.author.trust === "trusted" && <Badge tone="success">白名单</Badge>}
                    {comment.author.trust === "blocked" && <Badge>已拉黑</Badge>}
                    <span className={styles.where}>
                      评论了
                      <a href={`/posts/${comment.post.slug}#comments`} target="_blank" rel="noopener">
                        《{comment.post.title}》
                        <ExternalLink className={styles.externalIcon} aria-hidden="true" />
                        <span className="visually-hidden">（在新标签页打开）</span>
                      </a>
                    </span>
                    <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
                  </header>
                  {comment.parent && (
                    <blockquote className={styles.context}>
                      回复 @{comment.parent.login}：{comment.parent.excerpt}
                    </blockquote>
                  )}
                  {/* 与前台同一个渲染器和白名单 */}
                  <div className={styles.body} dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(comment.bodyMd) }} />
                  <div className={styles.actions}>
                    {status !== "approved" && (
                      <Button
                        variant="primary"
                        busy={busy}
                        onClick={() => void act(comment, () => adminApi.moderateComment(comment.id, "approved"), `已通过 ${who} 的评论`, only(comment))}
                      >
                        通过
                      </Button>
                    )}
                    {status === "pending" && comment.author.trust === "default" && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            comment,
                            () => adminApi.setCommenterTrust(comment.author.id, "trusted"),
                            `已把 ${who} 加入白名单，并通过了他的待审核评论`,
                            byAuthor(comment),
                          )
                        }
                      >
                        通过并加入白名单
                      </Button>
                    )}
                    {status !== "rejected" && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void act(comment, () => adminApi.moderateComment(comment.id, "rejected"), `已拒绝 ${who} 的评论`, only(comment))}
                      >
                        {status === "approved" ? "隐藏" : "拒绝"}
                      </Button>
                    )}
                    {status === "pending" && comment.author.trust !== "blocked" && (
                      <Button
                        variant="plainDestructive"
                        disabled={busy}
                        onClick={() =>
                          void act(comment, () => adminApi.setCommenterTrust(comment.author.id, "blocked"), `已拉黑 ${who}，并拒绝了他的待审核评论`, byAuthor(comment))
                        }
                      >
                        拉黑
                      </Button>
                    )}
                    <Button variant="plainDestructive" disabled={busy} onClick={() => setPendingDelete(comment)}>
                      删除
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条评论？"
        confirmLabel="删除"
        destructive
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) void act(target, () => adminApi.deleteComment(target.id), "已删除评论", only(target));
        }}
        onCancel={() => setPendingDelete(null)}
      >
        {pendingDelete?.parent === null ? "这是一楼的第一条评论，楼里的回复会一起删除，且无法恢复。" : "删除后无法恢复。"}
      </ConfirmDialog>
    </>
  );
}

function CommenterList() {
  const [state, setState] = useState<Load<AdminCommenter>>({ kind: "loading" });
  const [login, setLogin] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let ignore = false;
    adminApi.listCommenters().then(
      (items) => !ignore && setState({ kind: "ready", items }),
      (error: unknown) => !ignore && setState({ kind: "error", message: messageOf(error) }),
    );
    return () => {
      ignore = true;
    };
  }, []);

  function upsert(updated: AdminCommenter) {
    setState((prev) =>
      prev.kind === "ready"
        ? { ...prev, items: prev.items.some((c) => c.id === updated.id) ? prev.items.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...prev.items] }
        : prev,
    );
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (adding || login.trim() === "") return;
    setAdding(true);
    setAddError(undefined);
    try {
      const commenter = await adminApi.addTrustedCommenter(login.trim());
      upsert(commenter);
      setLogin("");
      setAnnouncement(`已把 @${commenter.login} 加入白名单`);
    } catch (error) {
      setAddError(messageOf(error));
    } finally {
      setAdding(false);
    }
  }

  async function changeTrust(commenter: AdminCommenter, trust: CommenterTrust) {
    setActionError(null);
    try {
      upsert(await adminApi.setCommenterTrust(commenter.id, trust));
      setAnnouncement(`@${commenter.login}：${trustOptions.find((o) => o.value === trust)?.label}`);
    } catch (error) {
      setActionError(messageOf(error));
    }
  }

  return (
    <>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
      <form className={styles.addForm} onSubmit={(event) => void add(event)}>
        <TextField
          label="按 GitHub 用户名加入白名单"
          hint="白名单里的人评论直接显示；其他人每条评论都要审核。对方还没来评论过也可以先加。"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          error={addError}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          accessory={
            <Button type="submit" variant="secondary" busy={adding}>
              加入
            </Button>
          }
        />
      </form>

      {actionError && (
        <Banner title="操作失败" className={styles.banner}>
          {actionError}
        </Banner>
      )}
      {state.kind === "loading" && (
        <p className={styles.placeholder}>
          <Spinner />
          正在加载…
        </p>
      )}
      {state.kind === "error" && <Banner title="评论者加载失败">{state.message}</Banner>}
      {state.kind === "ready" &&
        (state.items.length === 0 ? (
          <p className={styles.emptyLine}>还没有评论者。</p>
        ) : (
          <ul className={styles.list}>
            {state.items.map((commenter) => (
              <li key={commenter.id} className={`${styles.item} ${styles.commenter}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- GitHub 头像，后台不需要优化 */}
                <img className={styles.avatar} src={commenter.avatarUrl} alt="" width={32} height={32} />
                <a className={styles.author} href={`https://github.com/${commenter.login}`} target="_blank" rel="noopener noreferrer">
                  {commenter.name ?? commenter.login}
                  <span className={styles.login}>@{commenter.login}</span>
                </a>
                <SegmentedControl
                  className={styles.trust}
                  label={`@${commenter.login} 的权限`}
                  options={trustOptions}
                  value={commenter.trust}
                  onChange={(trust) => void changeTrust(commenter, trust)}
                />
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

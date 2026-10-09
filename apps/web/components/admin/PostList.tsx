"use client";

import type { AdminPost } from "@blog/shared";
import { ExternalLink, FilePlus2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClassName, ButtonLink } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import styles from "./PostList.module.css";
import { StatusBadge } from "./StatusBadge";

type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; posts: AdminPost[] };

function messageOf(error: unknown): string {
  return error instanceof AdminApiError ? error.message : "出现了意外错误，请稍后重试";
}

/** 后台文章列表：全部文章（含草稿），按更新时间倒序（API 的排序）。 */
export function PostList() {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [pendingDelete, setPendingDelete] = useState<AdminPost | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 每次 +1 触发重新加载（"重试"按钮）
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // ignore：组件卸载或重新加载后，旧请求的结果不再写入状态
    let ignore = false;
    adminApi.listPosts().then(
      (posts) => {
        if (!ignore) setState({ kind: "ready", posts });
      },
      (error: unknown) => {
        if (!ignore) setState({ kind: "error", message: messageOf(error) });
      },
    );
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  function retry() {
    setState({ kind: "loading" });
    setReloadKey((key) => key + 1);
  }

  function askDelete(post: AdminPost) {
    setDeleteError(undefined);
    setPendingDelete(post);
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    const target = pendingDelete;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await adminApi.deletePost(target.id);
    } catch (error) {
      // 已经被删掉了（比如在另一个标签页）：结果和成功一样
      if (!(error instanceof AdminApiError && error.code === "not_found")) {
        setDeleteError(messageOf(error));
        setDeleting(false);
        return;
      }
    }
    setState((prev) => (prev.kind === "ready" ? { ...prev, posts: prev.posts.filter((p) => p.id !== target.id) } : prev));
    setDeleting(false);
    setPendingDelete(null);
    setAnnouncement(`已删除《${target.title}》`);
    // 触发删除的按钮随这一行一起消失了，焦点交给页面标题，而不是丢回 <body>。
    // 等下一帧：对话框关闭（effect 里调用 close()）之前，页面其余部分是 inert 的，聚焦不上
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  const newPostLink = (
    <ButtonLink href="/admin/posts/new" variant="primary">
      <Plus aria-hidden="true" />
      新建文章
    </ButtonLink>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          文章
        </h1>
        {newPostLink}
      </header>

      <p role="status" className="visually-hidden">
        {announcement}
      </p>

      {state.kind === "loading" && (
        <p className={styles.placeholder}>
          <Spinner />
          正在加载文章…
        </p>
      )}

      {state.kind === "error" && (
        <Banner
          title="文章列表加载失败"
          action={
            <Button variant="secondary" onClick={retry}>
              重试
            </Button>
          }
        >
          {state.message}
        </Banner>
      )}

      {state.kind === "ready" && state.posts.length === 0 && (
        <div className={styles.empty}>
          <FilePlus2 className={styles.emptyIcon} aria-hidden="true" />
          <p className={styles.emptyTitle}>还没有文章</p>
          <p className={styles.emptyText}>写好的草稿和已发布的文章都会列在这里。</p>
        </div>
      )}

      {state.kind === "ready" && state.posts.length > 0 && (
        <>
          {/* 列标题只给视觉用户看；读屏用户从每行的 <dt> 得到同样的信息 */}
          <div className={styles.columns} aria-hidden="true">
            <span>标题</span>
            <span>状态</span>
            <span>更新时间</span>
            <span>发布时间</span>
          </div>
          <ul className={styles.list} aria-label="全部文章">
            {state.posts.map((post) => (
              <li key={post.id} className={styles.row}>
                <div className={styles.main}>
                  {/* 整行可点击进入编辑：链接的 ::after 铺满整行，DOM 里仍只有一个链接 */}
                  <Link href={`/admin/posts/${post.id}`} className={styles.link}>
                    {post.title}
                  </Link>
                  <span className={styles.slug}>/{post.slug}</span>
                </div>
                <div className={styles.meta}>
                  <div className={styles.status}>
                    <StatusBadge status={post.status} />
                  </div>
                  <dl className={styles.dates}>
                    <div>
                      <dt>更新于</dt>
                      <dd>
                        <time dateTime={post.updatedAt}>{formatDateTime(post.updatedAt)}</time>
                      </dd>
                    </div>
                    <div className={post.publishedAt ? undefined : styles.unpublished}>
                      <dt>发布于</dt>
                      <dd>
                        {post.publishedAt ? (
                          <time dateTime={post.publishedAt}>{formatDateTime(post.publishedAt)}</time>
                        ) : (
                          <>
                            <span aria-hidden="true">—</span>
                            <span className="visually-hidden">从未发布</span>
                          </>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className={styles.actions}>
                  {post.status === "published" && (
                    <a
                      href={`/posts/${post.slug}`}
                      target="_blank"
                      rel="noopener"
                      className={buttonClassName({ variant: "plain", iconOnly: true })}
                      aria-label={`在新标签页查看《${post.title}》`}
                    >
                      <ExternalLink aria-hidden="true" />
                    </a>
                  )}
                  <Button variant="plainDestructive" iconOnly aria-label={`删除《${post.title}》`} onClick={() => askDelete(post)}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`删除《${pendingDelete?.title ?? ""}》？`}
        confirmLabel="删除"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        {pendingDelete?.status === "published" ? "文章会从网站上移除，且无法恢复。" : "草稿删除后无法恢复。"}
      </ConfirmDialog>
    </div>
  );
}

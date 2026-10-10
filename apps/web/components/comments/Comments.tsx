"use client";

import type { CommenterMe, CommentList, PublicComment } from "@blog/shared";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { CommentApiError, commentsApi, githubLoginHref, loginResultMessage } from "@/lib/comments-api";
import { formatDate } from "@/lib/format";
import styles from "./Comments.module.css";
import { CommentForm } from "./CommentForm";

type Render = (markdown: string) => string;
type Data = { me: CommenterMe; list: CommentList };
type ReplyTarget = { threadId: number; parentId: number; login: string };

/** GitHub 头像按需要的尺寸取（2 倍屏用两倍像素） */
function avatarSrc(url: string, size: number): string {
  const src = new URL(url);
  src.searchParams.set("s", String(size * 2));
  return src.toString();
}

function CommentItem({
  comment,
  render,
  onReply,
}: {
  comment: PublicComment;
  render: Render | null;
  onReply?: (() => void) | undefined;
}) {
  const { author } = comment;
  return (
    <article className={styles.comment}>
      {/* GitHub 头像已用 ?s= 取了合适的尺寸；经 next/image 再优化一遍只会多消耗 Vercel 的图片优化额度 */}
      {/* eslint-disable-next-line @next/next/no-img-element -- 见上 */}
      <img className={styles.avatar} src={avatarSrc(author.avatarUrl, 40)} alt="" width={40} height={40} loading="lazy" />
      <div className={styles.main}>
        <header className={styles.meta}>
          <a className={styles.author} href={`https://github.com/${author.login}`} rel="nofollow ugc noopener noreferrer">
            {author.name ?? author.login}
          </a>
          {comment.replyTo && <span>回复 @{comment.replyTo.login}</span>}
          <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
          {comment.status === "pending" && <Badge>审核中，仅你可见</Badge>}
        </header>
        {/* 渲染器（单独打包）加载完之前先显示原文；html 来自 renderCommentMarkdown，已按评论白名单清洗 */}
        {render ? (
          <div className={styles.body} dangerouslySetInnerHTML={{ __html: render(comment.bodyMd) }} />
        ) : (
          <div className={`${styles.body} ${styles.plain}`}>{comment.bodyMd}</div>
        )}
        {onReply && (
          <Button variant="plain" className={styles.replyButton} onClick={onReply}>
            回复
          </Button>
        )}
      </div>
    </article>
  );
}

/**
 * 文章页的评论区。评论不进 ISR 页面，浏览器单独请求：滚动到评论区附近才加载，
 * 只读文章的读者不会多发请求；Markdown 渲染器也单独打包、按需加载，不增加文章页本身的体积。
 */
export function Comments({ slug }: { slug: string }) {
  const pathname = usePathname();
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [render, setRender] = useState<Render | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 评论区进入视口（提前 600px）时才开始加载
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let ignore = false;
    import("@/lib/comment-markdown").then(
      (module) => !ignore && setRender(() => module.renderCommentMarkdown),
      () => {
        // 渲染器加载失败就一直显示原文，不影响阅读
      },
    );
    Promise.all([commentsApi.me(), commentsApi.list(slug)]).then(
      ([me, list]) => {
        if (ignore) return;
        setData({ me, list });
        setLoadError(null);
        // 从 GitHub 登录回来时，API 在地址上加了 ?login=…：显示结果，然后从地址栏去掉，刷新时不再提示
        const url = new URL(window.location.href);
        const message = loginResultMessage(url.searchParams.get("login"));
        if (url.searchParams.has("login")) {
          url.searchParams.delete("login");
          window.history.replaceState(null, "", url);
        }
        if (message) setNotice(message);
      },
      (error: unknown) => {
        if (!ignore) setLoadError(error instanceof CommentApiError ? error.message : "评论加载失败");
      },
    );
    return () => {
      ignore = true;
    };
  }, [visible, slug, reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);
  const me = data?.me.commenter ?? null;
  const canReply = me !== null && me.trust !== "blocked";

  async function logout() {
    try {
      await commentsApi.logout();
      setReplyTarget(null);
      reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "退出失败");
    }
  }

  function submitted(comment: PublicComment) {
    setReplyTarget(null);
    setNotice(comment.status === "pending" ? "评论已提交，审核通过后所有人都能看到。" : null);
    reload();
  }

  const count = data?.list.count ?? 0;

  return (
    <section id="comments" ref={sectionRef} className={styles.section} aria-labelledby="comments-heading">
      <h2 id="comments-heading" className={styles.heading}>
        评论{count > 0 && <span className={styles.count}>{count}</span>}
      </h2>

      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}

      {loadError && (
        <Banner title="评论加载失败" action={<Button onClick={reload}>重试</Button>}>
          {loadError}
        </Banner>
      )}

      {!data && !loadError && (
        <p className={styles.loading} role="status">
          {visible && <Spinner />}
          <span>{visible ? "正在加载评论…" : ""}</span>
        </p>
      )}

      {data && (
        <>
          {!data.me.configured ? (
            <p className={styles.hint}>评论暂未开放。</p>
          ) : me ? (
            me.trust === "blocked" ? (
              <p className={styles.hint}>你已被禁止评论。</p>
            ) : (
              <CommentForm
                slug={slug}
                me={me}
                onLogout={logout}
                onSubmitted={submitted}
                label="发表评论"
                placeholder="写下你的想法…"
              />
            )
          ) : (
            <div className={styles.login}>
              <a className={buttonClassName({ variant: "secondary" })} href={githubLoginHref(pathname)}>
                用 GitHub 登录后评论
              </a>
              <p className={styles.hint}>只读取你的 GitHub 公开资料（用户名和头像）。</p>
            </div>
          )}

          {data.list.threads.length === 0 ? (
            <p className={styles.empty}>还没有评论。</p>
          ) : (
            <ol className={styles.threads}>
              {data.list.threads.map((thread) => (
                <li key={thread.id} className={styles.thread}>
                  <CommentItem
                    comment={thread}
                    render={render}
                    onReply={
                      canReply && thread.status === "approved"
                        ? () => setReplyTarget({ threadId: thread.id, parentId: thread.id, login: thread.author.login })
                        : undefined
                    }
                  />
                  {(thread.replies.length > 0 || replyTarget?.threadId === thread.id) && (
                    <ol className={styles.replies}>
                      {thread.replies.map((reply) => (
                        <li key={reply.id}>
                          <CommentItem
                            comment={reply}
                            render={render}
                            onReply={
                              canReply && reply.status === "approved"
                                ? () => setReplyTarget({ threadId: thread.id, parentId: reply.id, login: reply.author.login })
                                : undefined
                            }
                          />
                        </li>
                      ))}
                      {me && replyTarget?.threadId === thread.id && (
                        <li>
                          <CommentForm
                            key={replyTarget.parentId}
                            slug={slug}
                            me={me}
                            parentId={replyTarget.parentId}
                            label={`回复 @${replyTarget.login}`}
                            placeholder={`回复 @${replyTarget.login}…`}
                            autoFocus
                            onCancel={() => setReplyTarget(null)}
                            onSubmitted={submitted}
                          />
                        </li>
                      )}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

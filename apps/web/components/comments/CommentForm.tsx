"use client";

import { COMMENT_MAX_LENGTH, type CommenterMe, type PublicComment } from "@blog/shared";
import { type FormEvent, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextField";
import { CommentApiError, commentsApi } from "@/lib/comments-api";
import styles from "./Comments.module.css";

type Props = {
  slug: string;
  me: NonNullable<CommenterMe["commenter"]>;
  parentId?: number;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  /** 顶层表单显示"退出"；回复表单显示"取消" */
  onLogout?: () => void;
  onCancel?: () => void;
  onSubmitted: (comment: PublicComment) => void;
};

/** 发评论 / 回复的表单。⌘↩ / Ctrl+↩ 提交 */
export function CommentForm({ slug, me, parentId, label, placeholder, autoFocus, onLogout, onCancel, onSubmitted }: Props) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (sending || body.trim() === "") return;
    setSending(true);
    setError(null);
    try {
      const comment = await commentsApi.post(slug, { body, ...(parentId !== undefined && { parentId }) });
      setBody("");
      onSubmitted(comment);
    } catch (err) {
      setError(err instanceof CommentApiError ? err.message : "发送失败，请稍后重试");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <TextArea
        label={label}
        hideLabel
        placeholder={placeholder}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
        }}
        maxLength={COMMENT_MAX_LENGTH}
        // 回复框是用户点"回复"之后才出现的，聚焦它是预期之内的行为
        autoFocus={autoFocus}
        hint={me.trust === "trusted" ? "支持 Markdown。评论会直接显示。" : "支持 Markdown。审核通过后显示。"}
      />
      {error && <Banner title="发送失败">{error}</Banner>}
      <div className={styles.formBar}>
        <span className={styles.identity}>
          以 <strong>@{me.login}</strong> 的身份
          {onLogout && (
            <Button variant="plain" className={styles.inlineButton} onClick={onLogout}>
              退出
            </Button>
          )}
        </span>
        <span className={styles.formActions}>
          {onCancel && (
            <Button variant="plain" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button type="submit" variant="primary" busy={sending} disabled={body.trim() === ""}>
            {parentId === undefined ? "发表评论" : "回复"}
          </Button>
        </span>
      </div>
    </form>
  );
}

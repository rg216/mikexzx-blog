"use client";

import { COMMENT_MAX_LENGTH, type CommenterMe, type PublicComment } from "@blog/shared";
import { type FormEvent, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextField";
import { CommentApiError } from "@/lib/comments-api";
import { useDictionary } from "@/lib/i18n/client";
import styles from "./Comments.module.css";
import { commentErrorText } from "./comment-errors";

type Props = {
  me: NonNullable<CommenterMe["commenter"]>;
  label: string;
  placeholder?: string;
  submitLabel: string;
  /** 发评论、回复、编辑共用这个表单，具体调用哪个接口由外面决定 */
  submit: (body: string) => Promise<PublicComment>;
  onDone: (comment: PublicComment) => void;
  initialBody?: string;
  autoFocus?: boolean;
  /** 顶层表单显示身份和"退出"；回复、编辑表单显示"取消" */
  onLogout?: () => void;
  onCancel?: () => void;
};

/** 评论表单。⌘↩ / Ctrl+↩ 提交，Esc 取消 */
export function CommentForm({ me, label, placeholder, submitLabel, submit, onDone, initialBody = "", autoFocus, onLogout, onCancel }: Props) {
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dict = useDictionary().comments;
  const t = dict.form;
  const unchanged = body.trim() === "" || body === initialBody;

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (sending || unchanged) return;
    setSending(true);
    setError(null);
    try {
      const comment = await submit(body);
      setBody("");
      onDone(comment);
    } catch (err) {
      setError(commentErrorText(dict.errors, err instanceof CommentApiError ? err.reason : "unavailable"));
    } finally {
      setSending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void send(event)}>
      <TextArea
        label={label}
        hideLabel
        placeholder={placeholder}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
          if (event.key === "Escape" && onCancel) onCancel();
        }}
        maxLength={COMMENT_MAX_LENGTH}
        // 回复、编辑框是用户点了按钮之后才出现的，聚焦它是预期之内的行为
        autoFocus={autoFocus}
        hint={me.trust === "trusted" ? t.hintTrusted : t.hintModerated}
      />
      {error && <Banner title={t.sendErrorTitle}>{error}</Banner>}
      <div className={styles.formBar}>
        {onLogout && (
          <span className={styles.identity}>
            {t.identityBefore}
            <strong>@{me.login}</strong>
            {t.identityAfter}
            <Button variant="plain" className={styles.inlineButton} onClick={onLogout}>
              {t.signOut}
            </Button>
          </span>
        )}
        <span className={styles.formActions}>
          {onCancel && (
            <Button variant="plain" onClick={onCancel}>
              {t.cancel}
            </Button>
          )}
          <Button type="submit" variant="primary" busy={sending} disabled={unchanged}>
            {submitLabel}
          </Button>
        </span>
      </div>
    </form>
  );
}

"use client";

import { CircleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";

type Props = {
  open: boolean;
  title: string;
  /** 说明文字，会作为对话框的 aria-describedby */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 不可撤销的操作：确认按钮用红色 */
  destructive?: boolean;
  /** 确认操作进行中：不能取消、确认按钮显示转圈 */
  busy?: boolean;
  /** 确认操作失败时的错误信息，显示在对话框里，用户可以重试或取消 */
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 页面内的确认对话框（代替 window.confirm：样式可控、能显示进行中和失败状态）。
 *
 * 用原生 <dialog> + showModal()：焦点限制在对话框内、背景内容 inert、Esc 关闭、
 * 关闭后焦点回到打开前的元素——这些都是浏览器内置的，自己用 div 实现很容易漏。
 */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "取消", destructive = false, busy = false, error, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // 初始焦点放在"取消"上：误按回车不会触发不可撤销的操作
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={children ? descriptionId : undefined}
      // Esc：进行中不允许关闭；否则让浏览器关掉，再在 onClose 里同步状态
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={() => {
        if (open) onCancel();
      }}
    >
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {children && (
        <div id={descriptionId} className={styles.description}>
          {children}
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          <CircleAlert className={styles.errorIcon} aria-hidden="true" />
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? "destructive" : "primary"} busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

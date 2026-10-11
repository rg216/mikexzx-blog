"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button";
import styles from "./Dialog.module.css";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 底部固定的操作区（滚动内容时不跟着滚走） */
  footer?: ReactNode;
  /** wide：媒体选择器这类需要大面积的内容 */
  size?: "regular" | "wide";
};

/**
 * 通用的模态对话框（ConfirmDialog 是它的特例）。同样用原生 <dialog> + showModal()：
 * 焦点限制在对话框内、背景 inert、Esc 关闭、关闭后焦点回到打开前的元素，都是浏览器内置的。
 * 内容区单独滚动，标题和底部操作区始终可见。
 */
export function Dialog({ open, title, onClose, children, footer, size = "regular" }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${size === "wide" ? styles.wide : ""}`}
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onClose();
      }}
      // 点击遮罩（dialog 元素本身，而不是里面的内容）关闭
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <Button variant="plain" iconOnly aria-label="关闭" onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </dialog>
  );
}

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import styles from "./Button.module.css";
import { Spinner } from "./Spinner";

/**
 * primary           实心蓝：一个界面里最主要的操作，最多一个
 * secondary         灰底：次要操作（取消、保存草稿）
 * destructive       实心红：确认删除这类不可撤销的操作
 * plain             纯文字（accent 色）：工具栏、行内的轻量操作
 * plainDestructive  纯文字（红色）：列表里的"删除"入口（真正删除前还有一次确认）
 */
export type ButtonVariant = "primary" | "secondary" | "destructive" | "plain" | "plainDestructive";

type StyleProps = {
  variant?: ButtonVariant;
  /** 只有图标、没有文字：做成 44×44 的正方形。此时必须提供 aria-label。 */
  iconOnly?: boolean;
};

export function buttonClassName({ variant = "secondary", iconOnly = false }: StyleProps, className?: string): string {
  return [styles.button, styles[variant], iconOnly && styles.iconOnly, className].filter(Boolean).join(" ");
}

type ButtonProps = ComponentProps<"button"> &
  StyleProps & {
    /**
     * 进行中：显示转圈、忽略点击，但不设 disabled——
     * disabled 的按钮会丢失焦点，键盘用户按完"保存"焦点就跳回页面开头了。
     */
    busy?: boolean;
  };

export function Button({ variant, iconOnly, busy = false, className, type = "button", onClick, children, ...rest }: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      // 默认 type="button"：表单里的按钮默认是 submit，忘写 type 会误提交
      type={type}
      className={buttonClassName({ variant, iconOnly }, className)}
      aria-disabled={busy || undefined}
      onClick={handleClick}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & StyleProps;

/** 长得像按钮的链接：去往另一个页面的操作（"新建文章"）语义上是链接，不是按钮。 */
export function ButtonLink({ variant, iconOnly, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClassName({ variant, iconOnly }, className)} {...rest} />;
}

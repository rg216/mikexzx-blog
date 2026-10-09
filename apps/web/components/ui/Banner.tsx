import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./Banner.module.css";

type Props = {
  title?: string;
  children?: ReactNode;
  /** 右侧的操作（比如"重试"按钮） */
  action?: ReactNode;
  className?: string;
};

/**
 * 错误提示条：不属于某个字段的错误（网络、服务器、冲突）。
 * role="alert"：出现时读屏立即播报。文字用 label 色、只有图标是红色——
 * 彩色小字在淡色底上很难同时满足两种主题的对比度。
 */
export function Banner({ title, children, action, className }: Props) {
  return (
    <div role="alert" className={[styles.banner, className].filter(Boolean).join(" ")}>
      <CircleAlert className={styles.icon} aria-hidden="true" />
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div className={styles.text}>{children}</div>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

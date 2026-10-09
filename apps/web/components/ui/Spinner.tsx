import { LoaderCircle } from "lucide-react";
import styles from "./Spinner.module.css";

/** 纯装饰的转圈图标；进行中的状态要另外用文字（或 aria-live）告诉读屏用户。 */
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={[styles.spinner, className].filter(Boolean).join(" ")} aria-hidden="true" />;
}

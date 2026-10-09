import Link from "next/link";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>找不到这个页面</h1>
      <p className={styles.text}>链接可能写错了，或者文章已经被删除。</p>
      <Link href="/" className={styles.link}>
        回到首页
      </Link>
    </div>
  );
}

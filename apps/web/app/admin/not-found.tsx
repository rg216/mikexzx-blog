import Link from "next/link";
import styles from "@/app/[lang]/not-found.module.css";

// 后台界面只有中文；样式与前台的 404 相同
export default function AdminNotFound() {
  return (
    <main id="main" className={styles.wrap}>
      <h1 className={styles.title}>找不到这个页面</h1>
      <p className={styles.text}>链接可能写错了，或者内容已经被删除。</p>
      <Link href="/admin/posts" className={styles.link}>
        回到文章列表
      </Link>
    </main>
  );
}

import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import styles from "./not-found.module.css";

// 未匹配任何路由的网址也会渲染这里，此时不在 (site) 布局里，所以自己套上 SiteShell
export default function NotFound() {
  return (
    <SiteShell>
      <div className={styles.wrap}>
      <h1 className={styles.title}>找不到这个页面</h1>
      <p className={styles.text}>链接可能写错了，或者文章已经被删除。</p>
      <Link href="/" className={styles.link}>
        回到首页
        </Link>
      </div>
    </SiteShell>
  );
}

import type { Metadata } from "next";
import prose from "@/components/Prose.module.css";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "关于" };

export default function AboutPage() {
  return (
    <article>
      <h1 className={styles.title}>关于</h1>
      <div className={prose.prose}>
        <p>这是一个用来练习 Web 全栈开发的博客。博客是载体，学习是目的。</p>
        <p>
          前端用 Next.js，API 用 Hono + Drizzle + PostgreSQL。评论、鉴权、搜索、阅读计数这些通常会外包给第三方的功能，这里都刻意自己实现。
        </p>
      </div>
    </article>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/admin/LoginForm";
import { site } from "@/lib/site";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "登录" };

// 登录页在 (panel) 分组之外：不经过 SessionGate，也不显示后台导航
export default function LoginPage() {
  return (
    <main id="main" className={styles.main}>
      <Link href="/" className={styles.brand}>
        {site.name}
      </Link>
      <LoginForm />
    </main>
  );
}

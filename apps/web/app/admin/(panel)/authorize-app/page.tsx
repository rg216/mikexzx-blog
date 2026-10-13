import { appAuthorizeQuerySchema } from "@blog/shared";
import type { Metadata } from "next";
import { AppAuthorization } from "@/components/admin/AppAuthorization";
import styles from "@/components/admin/SettingsPage.module.css";
import { Banner } from "@/components/ui/Banner";

export const metadata: Metadata = { title: "允许 App 登录" };

/**
 * 原生 App 登录后台（见 @blog/shared 的 app-auth.ts）：App 在 ASWebAuthenticationSession 里打开这一页。
 * 它在 (panel) 里，没登录时 SessionGate 先带着完整网址跳去 Passkey 登录，登录完回到这里
 */
export default async function AuthorizeAppPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = appAuthorizeQuerySchema.safeParse(await searchParams);
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>允许 App 登录</h1>
      {query.success ? (
        <AppAuthorization query={query.data} />
      ) : (
        <Banner title="登录请求无效">这个网址不完整或已被改动。请回到 App 里重新点“登录”。</Banner>
      )}
    </div>
  );
}

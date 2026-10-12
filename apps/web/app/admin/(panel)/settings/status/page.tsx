import type { Metadata } from "next";
import { SettingsSectionTabs } from "@/components/admin/SettingsSectionTabs";
import styles from "@/components/admin/SettingsPage.module.css";
import { StatusView } from "@/components/admin/StatusView";

export const metadata: Metadata = { title: "状态" };

export default function StatusPage() {
  // 前端这次部署的提交号（Vercel 构建时注入；页面在构建时生成，写进去的就是这次部署的版本），和 API 的比较
  const webVersion = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
  return (
    <div className={styles.page}>
      <SettingsSectionTabs />
      <h1 className={styles.title}>状态</h1>
      <StatusView webVersion={webVersion} />
    </div>
  );
}

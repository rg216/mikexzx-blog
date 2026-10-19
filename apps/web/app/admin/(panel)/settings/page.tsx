import type { Metadata } from "next";
import { CoverSettings } from "@/components/admin/CoverSettings";
import { ModelSettings } from "@/components/admin/ModelSettings";
import { PasskeySettings } from "@/components/admin/PasskeySettings";
import { SettingsSectionTabs } from "@/components/admin/SettingsSectionTabs";
import styles from "@/components/admin/SettingsPage.module.css";

export const metadata: Metadata = { title: "设置" };

export default function SettingsPage() {
  return (
    <div className={styles.page}>
      <SettingsSectionTabs />
      <h1 className={styles.title}>设置</h1>
      <div className={styles.sections}>
        <ModelSettings />
        <CoverSettings />
        <PasskeySettings />
      </div>
    </div>
  );
}

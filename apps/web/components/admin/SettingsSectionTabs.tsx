import { SectionTabs } from "./SectionTabs";

const sections = [
  { href: "/admin/settings", label: "设置" },
  { href: "/admin/settings/status", label: "状态" },
] as const;

/** "设置"栏目下的二级导航：可以改的设置 / 只读的系统状态 */
export function SettingsSectionTabs() {
  return <SectionTabs label="设置" sections={sections} />;
}

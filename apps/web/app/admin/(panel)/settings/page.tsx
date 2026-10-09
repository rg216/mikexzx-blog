import type { Metadata } from "next";
import { PasskeySettings } from "@/components/admin/PasskeySettings";

export const metadata: Metadata = { title: "设置" };

export default function SettingsPage() {
  return <PasskeySettings />;
}

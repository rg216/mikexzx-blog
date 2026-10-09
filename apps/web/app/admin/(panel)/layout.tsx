import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { SessionGate } from "@/components/admin/SessionGate";
import shell from "@/components/SiteShell.module.css";

// (panel)：需要登录的后台页面。登录页 /admin/login 在这个分组之外，不经过 SessionGate
export default function AdminPanelLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminNav actions={<LogoutButton />} />
      <main id="main" className={shell.main}>
        <SessionGate>{children}</SessionGate>
      </main>
    </>
  );
}

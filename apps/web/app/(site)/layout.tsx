import type { ReactNode } from "react";
import { SiteShell } from "@/components/SiteShell";

// (site) 是 route group：括号目录不出现在网址里，只用来给前台页面套上 SiteShell，与 /admin 区分开
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}

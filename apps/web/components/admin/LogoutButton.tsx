"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { createAuthApi } from "@/lib/auth-api";

/** 退出登录：删除服务端 session，然后整页跳到登录页（丢弃页面上所有已登录状态）。 */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    // 即使请求失败也跳转：cookie 可能已经失效，留在后台页面没有意义
    await createAuthApi()
      .logout()
      .catch(() => {});
    // 整页跳转而不是 router.push：退出后页面上所有已登录状态都应丢弃，干净地重新加载
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 见上
    window.location.assign("/admin/login");
  }

  return (
    <Button variant="plain" busy={busy} onClick={logout}>
      <LogOut aria-hidden="true" />
      退出登录
    </Button>
  );
}

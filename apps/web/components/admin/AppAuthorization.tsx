"use client";

import { appAuthCodeSchema, type AppAuthorizeQuery } from "@blog/shared";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { AdminApiError, createJsonClient } from "@/lib/admin-api";
import styles from "./AppAuthorization.module.css";

/**
 * 确认页：允许这台设备上的 App 用管理员身份登录。
 *
 * 必须由管理员明确点"允许"，不能打开就发授权码：授权网址谁都能构造，别人把网址发给你、你一点开
 * （浏览器里正登录着），授权码就会跳到别人在自己设备上注册的同名网址协议上，他用自己的 verifier 就能换到 token。
 * 设备名是 App 自己报的，只用来提醒，不能当作身份证明。
 */
export function AppAuthorization({ query }: { query: AppAuthorizeQuery }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function returnToApp(params: Record<string, string>) {
    const url = new URL(query.redirect_uri);
    for (const [key, value] of Object.entries({ ...params, state: query.state })) url.searchParams.set(key, value);
    window.location.assign(url.href);
  }

  async function allow() {
    setBusy(true);
    setError(null);
    try {
      const client = createJsonClient({ basePath: "/api/auth" });
      const res = await client.request("POST", "/app/codes", { codeChallenge: query.challenge, deviceName: query.device });
      const { code } = await client.parseJson(res, appAuthCodeSchema);
      returnToApp({ code });
    } catch (caught: unknown) {
      setError(caught instanceof AdminApiError ? caught.message : "无法完成授权，请重试");
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <p className={styles.lead}>
        <strong>{query.device}</strong> 上的 mikexxz App 请求登录后台。
      </p>
      <p className={styles.hint}>
        只有在你刚刚在 App 里点了“登录”时才允许。允许后，这台设备可以像网页一样管理文章、标签、评论和媒体库，直到在 App 里退出，或闲置 7 天、最长 30 天后过期。
      </p>
      {error && <Banner title="授权失败">{error}</Banner>}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => returnToApp({ error: "access_denied" })}>
          取消
        </Button>
        <Button variant="primary" busy={busy} onClick={() => void allow()}>
          允许
        </Button>
      </div>
    </div>
  );
}

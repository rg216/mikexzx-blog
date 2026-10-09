"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { KeyRound, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { AdminApiError } from "@/lib/admin-api";
import { createAuthApi } from "@/lib/auth-api";
import { safeNextPath } from "@/lib/auth-redirect";
import { describeWebAuthnError } from "@/lib/webauthn-errors";
import styles from "./LoginForm.module.css";

type Mode = "login" | "setup";
type Phase = { kind: "loading" } | { kind: "unsupported" } | { kind: "ready"; hasPasskeys: boolean };

const api = createAuthApi();

/** API 错误用服务端给的说明；浏览器 WebAuthn 的失败翻译成中文 */
function describe(error: unknown): string {
  return error instanceof AdminApiError ? error.message : describeWebAuthnError(error);
}

/**
 * 登录页：
 * - 有 Passkey：一个按钮，浏览器列出本站可用的 Passkey（可发现凭证，不用输用户名）；
 * - 还没有 Passkey（首次设置），或所有设备都丢了（恢复）：用 ADMIN_SETUP_TOKEN 注册一个新的。
 */
export function LoginForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const [passkeyName, setPasskeyName] = useState("");

  // next 只在跳转时读：直接读 location，省掉 useSearchParams 需要的 Suspense 边界
  function goToNext() {
    router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
  }

  useEffect(() => {
    let cancelled = false;
    // 已经登录就直接进后台；否则检查浏览器支持、是否需要首次设置
    api
      .session()
      .then(() => {
        if (!cancelled) router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
      })
      .catch(async () => {
        if (!browserSupportsWebAuthn()) {
          if (!cancelled) setPhase({ kind: "unsupported" });
          return;
        }
        const status = await api.status().catch(() => ({ hasPasskeys: true }));
        if (cancelled) return;
        setPhase({ kind: "ready", hasPasskeys: status.hasPasskeys });
        if (!status.hasPasskeys) setMode("setup");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api.loginOptions();
      const response = await startAuthentication({ optionsJSON });
      await api.loginVerify(response);
      goToNext();
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  async function setup(event: FormEvent) {
    event.preventDefault();
    if (!setupToken.trim()) {
      setError("请填写设置口令");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api.registrationOptions(setupToken.trim());
      const response = await startRegistration({ optionsJSON });
      await api.registrationVerify(response, passkeyName.trim() || undefined);
      goToNext(); // 注册成功即登录
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  if (phase.kind === "loading") {
    return (
      <div className={styles.card} role="status">
        <Spinner />
        <span className={styles.muted}>正在检查…</span>
      </div>
    );
  }

  if (phase.kind === "unsupported") {
    return (
      <div className={styles.card}>
        <Banner title="这个浏览器不支持 Passkey">请使用最新版的 Safari、Chrome、Edge 或 Firefox。</Banner>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      {mode === "login" ? (
        <>
          <h1 className={styles.title}>登录后台</h1>
          <p className={styles.description}>使用这台设备或密码管理器里保存的 Passkey 登录，没有密码。</p>
          {error && <Banner className={styles.banner}>{error}</Banner>}
          <Button variant="primary" className={styles.wide} busy={busy} onClick={login}>
            {!busy && <KeyRound aria-hidden="true" />}
            使用 Passkey 登录
          </Button>
          <Button
            variant="plain"
            className={styles.switch}
            onClick={() => {
              setMode("setup");
              setError(null);
            }}
          >
            首次设置或恢复访问
          </Button>
        </>
      ) : (
        <form onSubmit={setup} noValidate>
          <h1 className={styles.title}>{phase.hasPasskeys ? "恢复访问" : "首次设置"}</h1>
          <p className={styles.description}>
            {phase.hasPasskeys
              ? "所有设备都丢失时，可以用设置口令为新设备注册 Passkey。"
              : "还没有任何 Passkey。输入部署时配置的设置口令，为这台设备创建第一个 Passkey。"}
            用完后请从服务器环境变量中删除 <code>ADMIN_SETUP_TOKEN</code>。
          </p>
          {error && <Banner className={styles.banner}>{error}</Banner>}
          <div className={styles.fields}>
            <TextField
              label="设置口令"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              required
            />
            <TextField
              label="Passkey 名称"
              hint="方便以后辨认，可不填"
              placeholder="如 MacBook Touch ID"
              maxLength={50}
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" className={styles.wide} busy={busy}>
            {!busy && <Plus aria-hidden="true" />}
            创建 Passkey
          </Button>
          {phase.hasPasskeys && (
            <Button
              variant="plain"
              className={styles.switch}
              onClick={() => {
                setMode("login");
                setError(null);
              }}
            >
              返回登录
            </Button>
          )}
        </form>
      )}
    </div>
  );
}

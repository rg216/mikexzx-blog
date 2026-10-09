"use client";

import type { SessionInfo } from "@blog/shared";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { AdminApiError, redirectToLogin } from "@/lib/admin-api";
import { createAuthApi } from "@/lib/auth-api";
import styles from "./SessionGate.module.css";

const SessionContext = createContext<SessionInfo | null>(null);

/** 在 SessionGate 之内读取当前 session */
export function useSession(): SessionInfo {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession 必须在 <SessionGate> 内使用");
  return session;
}

type State = { kind: "checking" } | { kind: "ready"; session: SessionInfo } | { kind: "error"; message: string };

/**
 * 后台页面的登录检查：确认有 session 之后才渲染内容，没登录就带着 next 跳到登录页。
 * 这只是体验层面的门——真正的权限控制在 API（每个管理接口都校验 session）。
 * 检查期间不渲染子组件，避免未登录时页面先闪一下、再发出一堆注定 401 的请求。
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    createAuthApi()
      .session()
      .then((session) => {
        if (!cancelled) setState({ kind: "ready", session });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof AdminApiError && error.status === 401) redirectToLogin();
        else setState({ kind: "error", message: error instanceof Error ? error.message : "无法确认登录状态" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.kind === "checking") {
    return (
      <div className={styles.status} role="status">
        <Spinner />
        <span>正在确认登录状态…</span>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <Banner
        title="无法确认登录状态"
        action={
          <Button
            onClick={() => {
              setState({ kind: "checking" });
              setAttempt((n) => n + 1);
            }}
          >
            重试
          </Button>
        }
      >
        {state.message}
      </Banner>
    );
  }
  return <SessionContext value={state.session}>{children}</SessionContext>;
}

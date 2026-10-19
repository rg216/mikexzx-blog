"use client";

import type { SiteSettings } from "@blog/shared";
import { useEffect, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";

export type SettingsState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; settings: SiteSettings };

const describe = (error: unknown) => (error instanceof AdminApiError ? error.message : "网络错误，请稍后再试");

/**
 * 设置页各节共用的读写逻辑：读一次设置；改一项时先显示新值，失败再退回（选中状态跟着点击立刻变，不用等网络）。
 * 每节各自调用（各读一次）：各节改的键互不重叠，PATCH 只发自己的键。
 */
export function useSiteSettings() {
  const [state, setState] = useState<SettingsState>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState<keyof SiteSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getSettings()
      .then((settings) => {
        if (!cancelled) setState({ kind: "ready", settings });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: describe(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  /** 保存一项；成功时读屏播报 done。返回是否保存成功 */
  async function save<K extends keyof SiteSettings>(key: K, value: SiteSettings[K], done: string): Promise<boolean> {
    if (state.kind !== "ready" || state.settings[key] === value) return true;
    const previous = state.settings;
    setState({ kind: "ready", settings: { ...previous, [key]: value } });
    setSaving(key);
    setError(null);
    try {
      const settings = await adminApi.updateSettings({ [key]: value });
      setState({ kind: "ready", settings });
      setAnnouncement(done);
      return true;
    } catch (err) {
      setState({ kind: "ready", settings: previous });
      setError(describe(err));
      return false;
    } finally {
      setSaving(null);
    }
  }

  return { state, retry: () => setReload((n) => n + 1), saving, error, announcement, save };
}

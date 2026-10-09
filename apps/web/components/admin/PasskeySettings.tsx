"use client";

import type { Passkey } from "@blog/shared";
import { startRegistration } from "@simplewebauthn/browser";
import { Cloud, KeyRound, Plus, Smartphone } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { AdminApiError } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import { createAuthApi } from "@/lib/auth-api";
import { describeWebAuthnError } from "@/lib/webauthn-errors";
import { useSession } from "./SessionGate";
import styles from "./PasskeySettings.module.css";

const api = createAuthApi();

const describe = (error: unknown) => (error instanceof AdminApiError ? error.message : describeWebAuthnError(error));

type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; passkeys: Passkey[] };

/** 设置页：管理 Passkey（添加 / 重命名 / 删除）和登录会话（登出所有设备）。 */
export function PasskeySettings() {
  const session = useSession();
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  // 屏幕阅读器播报操作结果
  const [announcement, setAnnouncement] = useState("");

  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ id: string; name: string; error?: string; busy?: boolean } | null>(null);
  const [deleting, setDeleting] = useState<{ passkey: Passkey; error?: string; busy?: boolean } | null>(null);
  const [logoutAll, setLogoutAll] = useState<{ error?: string; busy?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listPasskeys()
      .then((passkeys) => {
        if (!cancelled) setList({ kind: "ready", passkeys });
      })
      .catch((error: unknown) => {
        if (!cancelled) setList({ kind: "error", message: describe(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  function replacePasskeys(update: (passkeys: Passkey[]) => Passkey[]) {
    setList((current) => (current.kind === "ready" ? { kind: "ready", passkeys: update(current.passkeys) } : current));
  }

  async function addPasskey(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      const optionsJSON = await api.registrationOptions();
      const response = await startRegistration({ optionsJSON });
      const passkey = await api.registrationVerify(response, newName.trim() || undefined);
      replacePasskeys((passkeys) => [...passkeys, passkey]);
      setNewName("");
      setAnnouncement(`已添加 Passkey「${passkey.name}」`);
    } catch (error) {
      setAddError(describe(error));
    } finally {
      setAdding(false);
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      setEditing({ ...editing, error: "名称不能为空" });
      return;
    }
    setEditing({ ...editing, busy: true, error: undefined });
    try {
      const updated = await api.renamePasskey(editing.id, name);
      replacePasskeys((passkeys) => passkeys.map((p) => (p.id === updated.id ? updated : p)));
      setEditing(null);
      setAnnouncement(`已重命名为「${updated.name}」`);
    } catch (error) {
      setEditing({ ...editing, busy: false, error: describe(error) });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleting({ ...deleting, busy: true, error: undefined });
    try {
      await api.deletePasskey(deleting.passkey.id);
      replacePasskeys((passkeys) => passkeys.filter((p) => p.id !== deleting.passkey.id));
      setAnnouncement(`已删除 Passkey「${deleting.passkey.name}」`);
      setDeleting(null);
    } catch (error) {
      // 删除最后一个会得到 409，说明会显示在对话框里
      setDeleting({ ...deleting, busy: false, error: describe(error) });
    }
  }

  async function confirmLogoutAll() {
    setLogoutAll({ busy: true });
    try {
      await api.logoutAll();
      // 当前 session 也已失效：整页跳转，丢弃页面上的已登录状态
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 见上
      window.location.assign("/admin/login");
    } catch (error) {
      setLogoutAll({ busy: false, error: describe(error) });
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>设置</h1>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>

      <section className={styles.section} aria-labelledby="passkeys-heading">
        <h2 id="passkeys-heading" className={styles.sectionTitle}>
          Passkey
        </h2>
        <p className={styles.sectionHint}>
          登录后台的唯一方式。可同步的 Passkey 会通过 iCloud 钥匙串、Google 密码管理器等同步到你的其他设备。
        </p>

        {list.kind === "loading" && (
          <div className={styles.placeholder} role="status">
            <Spinner />
            <span>正在加载…</span>
          </div>
        )}
        {list.kind === "error" && (
          <Banner title="加载失败" action={<Button onClick={() => setReload((n) => n + 1)}>重试</Button>}>
            {list.message}
          </Banner>
        )}
        {list.kind === "ready" && (
          <ul className={styles.list}>
            {list.passkeys.map((passkey) => (
              <li key={passkey.id} className={styles.item}>
                {editing?.id === passkey.id ? (
                  <form className={styles.renameForm} onSubmit={saveName} noValidate>
                    <TextField
                      label="Passkey 名称"
                      hideLabel
                      autoFocus
                      maxLength={50}
                      value={editing.name}
                      error={editing.error}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className={styles.renameField}
                    />
                    <div className={styles.renameActions}>
                      <Button onClick={() => setEditing(null)}>取消</Button>
                      <Button type="submit" variant="primary" busy={editing.busy}>
                        保存
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <span className={styles.icon} aria-hidden="true">
                      {passkey.deviceType === "multiDevice" ? <Cloud /> : <Smartphone />}
                    </span>
                    <div className={styles.info}>
                      <p className={styles.name}>{passkey.name}</p>
                      <p className={styles.meta}>
                        {passkey.deviceType === "multiDevice" ? "可同步" : "仅限这台设备"}
                        {" · "}添加于 {formatDateTime(passkey.createdAt)}
                        {" · "}
                        {passkey.lastUsedAt ? `最近使用 ${formatDateTime(passkey.lastUsedAt)}` : "尚未用于登录"}
                      </p>
                    </div>
                    <div className={styles.actions}>
                      <Button variant="plain" onClick={() => setEditing({ id: passkey.id, name: passkey.name })}>
                        重命名
                      </Button>
                      <Button variant="plainDestructive" onClick={() => setDeleting({ passkey })}>
                        删除
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form className={styles.addForm} onSubmit={addPasskey} noValidate>
          <TextField
            label="新 Passkey 的名称"
            placeholder="如 iPhone"
            hint="在当前设备、手机或安全密钥上创建一个新的 Passkey"
            maxLength={50}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={styles.addField}
          />
          <Button type="submit" variant="secondary" busy={adding} className={styles.addButton}>
            {!adding && <Plus aria-hidden="true" />}
            添加 Passkey
          </Button>
        </form>
        {addError && <Banner className={styles.addError}>{addError}</Banner>}
      </section>

      <section className={styles.section} aria-labelledby="session-heading">
        <h2 id="session-heading" className={styles.sectionTitle}>
          登录会话
        </h2>
        <p className={styles.sectionHint}>
          <KeyRound className={styles.inlineIcon} aria-hidden="true" />
          当前登录最晚于 {formatDateTime(session.expiresAt)} 失效；7 天不活动会提前失效。
        </p>
        <Button variant="plainDestructive" onClick={() => setLogoutAll({})}>
          登出所有设备
        </Button>
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title={`删除 Passkey「${deleting?.passkey.name ?? ""}」？`}
        confirmLabel="删除"
        destructive
        busy={deleting?.busy}
        error={deleting?.error}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      >
        删除后就不能再用它登录了。设备上保存的 Passkey 需要在系统设置里另行删除。
      </ConfirmDialog>

      <ConfirmDialog
        open={logoutAll !== null}
        title="登出所有设备？"
        confirmLabel="全部登出"
        destructive
        busy={logoutAll?.busy}
        error={logoutAll?.error}
        onConfirm={confirmLogoutAll}
        onCancel={() => setLogoutAll(null)}
      >
        包括当前这台设备在内，所有已登录的浏览器都需要重新用 Passkey 登录。
      </ConfirmDialog>
    </div>
  );
}

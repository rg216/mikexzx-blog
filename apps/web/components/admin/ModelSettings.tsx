"use client";

import { type SiteSettings, type TranslationModelId, translationModels } from "@blog/shared";
import { useEffect, useId, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { modelPriceLabel } from "@/lib/system-status";
import page from "./SettingsPage.module.css";
import styles from "./ModelSettings.module.css";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; settings: SiteSettings };

const describe = (error: unknown) => (error instanceof AdminApiError ? error.message : "网络错误，请稍后再试");

/** 文章和标签各自选一个模型：标签名很短，用便宜的模型就够，文章要准确 */
const purposes = [
  { key: "translationModel", label: "文章翻译", hint: "标题和正文。准确优先：默认 Sonnet 5.5，长文、术语多时可以换 Opus 5.5" },
  { key: "tagTranslationModel", label: "标签翻译", hint: "标签名只有几个词，Haiku 5.5 通常就够，费用约是 Sonnet 的 1/20" },
] as const;

/**
 * 设置页的"翻译模型"一节。选了就保存（和 iOS 设置一样，没有单独的保存按钮），失败时退回原来的选项。
 * 已经打开的译文编辑页不受影响：编辑器在页面打开时读取模型，生成一篇译文的过程中不换模型（提示缓存按模型分开）。
 */
export function ModelSettings() {
  const [state, setState] = useState<State>({ kind: "loading" });
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

  async function choose(key: keyof SiteSettings, model: TranslationModelId) {
    if (state.kind !== "ready" || state.settings[key] === model) return;
    const previous = state.settings;
    // 先显示新选项，失败再退回：选中状态跟着点击立刻变，不用等网络
    setState({ kind: "ready", settings: { ...previous, [key]: model } });
    setSaving(key);
    setError(null);
    try {
      const settings = await adminApi.updateSettings({ [key]: model });
      setState({ kind: "ready", settings });
      const purpose = purposes.find((p) => p.key === key)?.label ?? "";
      setAnnouncement(`${purpose}已改用 ${translationModels.find((m) => m.id === model)?.name ?? model}`);
    } catch (err) {
      setState({ kind: "ready", settings: previous });
      setError(describe(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section aria-labelledby="models-heading">
      <h2 id="models-heading" className={page.sectionTitle}>
        翻译模型
      </h2>
      <p className={page.sectionHint}>大模型翻译用的 Claude 模型，改了马上生效（已经打开的译文编辑页刷新后才用新模型）。价格只作比较，以 Anthropic 的价格页为准。</p>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>

      {state.kind === "loading" && (
        <div className={page.placeholder} role="status">
          <Spinner />
          <span>正在加载…</span>
        </div>
      )}
      {state.kind === "error" && (
        <Banner title="加载失败" action={<Button onClick={() => setReload((n) => n + 1)}>重试</Button>}>
          {state.message}
        </Banner>
      )}
      {state.kind === "ready" && (
        <div className={styles.purposes}>
          {error && <Banner title="没有保存">{error}</Banner>}
          {purposes.map((purpose) => (
            <ModelChoice
              key={purpose.key}
              label={purpose.label}
              hint={purpose.hint}
              value={state.settings[purpose.key]}
              saving={saving === purpose.key}
              onChange={(model) => void choose(purpose.key, model)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** 一组单选：iOS 分组列表的样子，每行是模型名、说明和价格；整行可点（label 包着 radio） */
function ModelChoice({
  label,
  hint,
  value,
  saving,
  onChange,
}: {
  label: string;
  hint: string;
  value: TranslationModelId;
  saving: boolean;
  onChange: (model: TranslationModelId) => void;
}) {
  const name = useId();
  const hintId = `${name}-hint`;
  return (
    <fieldset className={styles.group} aria-describedby={hintId} aria-busy={saving}>
      <legend className={styles.legend}>
        {label}
        {saving && <Spinner className={styles.spinner} />}
      </legend>
      <p id={hintId} className={styles.hint}>
        {hint}
      </p>
      <div className={page.list}>
        {translationModels.map((model) => (
          <label key={model.id} className={`${page.item} ${styles.option}`}>
            <input type="radio" name={name} value={model.id} checked={value === model.id} onChange={() => onChange(model.id)} className={styles.radio} />
            <span className={styles.text}>
              <span className={styles.name}>{model.name}</span>
              <span className={styles.summary}>{model.summary}</span>
              <span className={styles.price}>{modelPriceLabel(model)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

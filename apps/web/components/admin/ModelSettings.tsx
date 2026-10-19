"use client";

import { translationModels } from "@blog/shared";
import { useId } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { modelPriceLabel } from "@/lib/system-status";
import page from "./SettingsPage.module.css";
import styles from "./ModelSettings.module.css";
import { type SettingsState, useSiteSettings } from "./useSiteSettings";

/** 文章和标签各自选一个模型：标签名很短，用便宜的模型就够，文章要准确 */
const purposes = [
  { key: "translationModel", label: "文章翻译", hint: "标题和正文。准确优先：默认 Sonnet 5.5，长文、术语多时可以换 Opus 5.5" },
  { key: "tagTranslationModel", label: "标签翻译", hint: "标签名只有几个词，Haiku 5.5 通常就够，费用约是 Sonnet 的 1/20" },
] as const;

export const claudeModelOptions = translationModels.map((model) => ({ id: model.id, name: model.name, summary: model.summary, detail: modelPriceLabel(model) }));

/**
 * 设置页的"翻译模型"一节。选了就保存（和 iOS 设置一样，没有单独的保存按钮），失败时退回原来的选项。
 * 已经打开的译文编辑页不受影响：编辑器在页面打开时读取模型，生成一篇译文的过程中不换模型（提示缓存按模型分开）。
 */
export function ModelSettings() {
  const { state, retry, saving, error, announcement, save } = useSiteSettings();

  return (
    <section aria-labelledby="models-heading">
      <h2 id="models-heading" className={page.sectionTitle}>
        翻译模型
      </h2>
      <p className={page.sectionHint}>大模型翻译用的 Claude 模型，改了马上生效（已经打开的译文编辑页刷新后才用新模型）。价格只作比较，以 Anthropic 的价格页为准。</p>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
      <SettingsLoading state={state} onRetry={retry} />
      {state.kind === "ready" && (
        <div className={styles.purposes}>
          {error && <Banner title="没有保存">{error}</Banner>}
          {purposes.map((purpose) => (
            <OptionGroup
              key={purpose.key}
              label={purpose.label}
              hint={purpose.hint}
              options={claudeModelOptions}
              value={state.settings[purpose.key]}
              saving={saving === purpose.key}
              onChange={(model) => void save(purpose.key, model, `${purpose.label}已改用 ${translationModels.find((m) => m.id === model)?.name ?? model}`)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** 设置还没读出来时的占位和读取失败的提示（各节共用） */
export function SettingsLoading({ state, onRetry }: { state: SettingsState; onRetry: () => void }) {
  if (state.kind === "loading") {
    return (
      <div className={page.placeholder} role="status">
        <Spinner />
        <span>正在加载…</span>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <Banner title="加载失败" action={<Button onClick={onRetry}>重试</Button>}>
        {state.message}
      </Banner>
    );
  }
  return null;
}

export type Option<T extends string> = { id: T; name: string; summary: string; detail?: string };

/** 一组单选：iOS 分组列表的样子，每行是名称、说明和补充（如价格）；整行可点（label 包着 radio） */
export function OptionGroup<T extends string>({
  label,
  hint,
  options,
  value,
  saving,
  onChange,
}: {
  label: string;
  hint: string;
  options: readonly Option<T>[];
  value: T;
  saving: boolean;
  onChange: (value: T) => void;
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
        {options.map((option) => (
          <label key={option.id} className={`${page.item} ${styles.option}`}>
            <input type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} className={styles.radio} />
            <span className={styles.text}>
              <span className={styles.name}>{option.name}</span>
              <span className={styles.summary}>{option.summary}</span>
              {option.detail && <span className={styles.price}>{option.detail}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

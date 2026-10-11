"use client";

import type { StructureCheckResult, StructureIssue, TranslationUsage } from "@blog/shared";
import { CircleAlert, Sparkles, Square, TriangleAlert } from "lucide-react";
import type { RefObject } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { formatUsage, stepLabel, unavailableReasonNotes } from "@/lib/translation-generation";
import { type GeneratedSnapshot, type GeneratedState, generatedStateLabels, modelDisplayName } from "@/lib/translation-form";
import styles from "./TranslationGenerator.module.css";
import type { TranslationGeneration } from "./useTranslationGeneration";

/** 一次成功的生成：编辑器里的机器译文快照，加上用量和结构校验结果（生成完成时在浏览器里算的） */
export type GeneratedResult = GeneratedSnapshot & { usage: TranslationUsage; check: StructureCheckResult };

type Props = {
  generation: TranslationGeneration;
  /** 最近一次成功生成的结果（没有、或已作废时为 null） */
  result: GeneratedResult | null;
  /** 编辑器当前内容相对 result 的状态 */
  resultState: GeneratedState;
  /** 编辑器当前内容超出保存上限的地方（生成过译文时才有，见 translationLengthProblems） */
  lengthProblems: string[];
  /** 正在保存 / 删除 / 载入原文等：暂时不能开始生成 */
  busy: boolean;
  /** 生成 / 停止按钮（同一个元素）：失败提示里的按钮让提示消失后，焦点交给它 */
  generateButtonRef: RefObject<HTMLButtonElement | null>;
  onGenerate: () => void;
  onRetry: () => void;
  onReloadSource: () => Promise<void>;
  reloadingSource: boolean;
};

/**
 * 焦点所在的元素被移出 DOM 后（失败提示消失、确认对话框关闭后要还焦点的按钮已经不在），焦点会掉到 body，
 * 键盘和读屏用户得从页面开头重新找。这时把焦点交给生成 / 停止按钮。焦点还在别处（作者已经点到别的地方）时不动。
 * 等下一帧：React 提交、对话框关闭之后，才知道焦点最后落在哪。
 */
export function focusGenerateButtonIfLost(ref: RefObject<HTMLButtonElement | null>) {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) ref.current?.focus();
  });
}

/**
 * 译文编辑器里"大模型翻译"的一栏：生成按钮、进度和停止、失败提示、生成结果（结构校验、用量）。
 * 流程和状态在 useTranslationGeneration / lib/translation-generation.ts，这里只负责显示。
 */
export function TranslationGenerator({
  generation,
  result,
  resultState,
  lengthProblems,
  busy,
  generateButtonRef,
  onGenerate,
  onRetry,
  onReloadSource,
  reloadingSource,
}: Props) {
  const { config, run } = generation;
  const available = config.kind === "ready" && config.config.available;
  const modelName = config.kind === "ready" ? modelDisplayName(config.config.model) : null;

  const configNote =
    config.kind === "loading"
      ? "正在读取翻译配置…"
      : config.kind === "error"
        ? `无法读取翻译配置：${config.message}`
        : !config.config.available
          ? unavailableReasonNotes[config.config.reason]
          : "生成的译文先放进编辑器，检查之后保存才对读者可见";

  // 一直渲染同一个 role=status 元素、只换文字：读屏才会播报进度变化。
  // 失败时留空：由 role=alert 的失败提示说话（否则上一次的"译文已生成"会和"生成失败"同时播报）
  const statusText =
    run.kind === "running"
      ? `正在翻译${stepLabel(run.progress)}${run.progress.thinking ? "（模型思考中…）" : "…"}`
      : run.kind === "stopped"
        ? "已停止，编辑器保持生成前的内容"
        : run.kind === "failed"
          ? ""
          : result && resultState === "unmodified"
            ? "译文已生成，请检查后保存"
            : "";

  return (
    <section className={styles.panel} aria-label="大模型翻译">
      <div className={styles.row}>
        {/* 同一个位置、同一个元素（React 复用）：焦点和 ref 在"生成"与"停止"之间保持；双击的第二下由 stop() 的保护期挡掉 */}
        {run.kind === "running" ? (
          <Button ref={generateButtonRef} variant="secondary" onClick={generation.stop}>
            <Square aria-hidden="true" />
            停止
          </Button>
        ) : (
          <Button ref={generateButtonRef} variant="secondary" disabled={!available || busy} onClick={onGenerate}>
            <Sparkles aria-hidden="true" />
            {modelName ? `用 ${modelName} 生成译文` : "生成译文"}
          </Button>
        )}
        <p role="status" className={styles.status}>
          {run.kind === "running" && <Spinner />}
          {statusText}
        </p>
        {run.kind !== "running" && !statusText && <p className={styles.note}>{configNote}</p>}
        {/* 读取失败、或者 Redis 暂时连不上（会自己恢复）：可以重新读取配置 */}
        {(config.kind === "error" || (config.kind === "ready" && !config.config.available && config.config.reason === "rate_limiter_unavailable")) && (
          <Button variant="plain" onClick={generation.reloadConfig}>
            重试
          </Button>
        )}
      </div>

      {run.kind === "failed" && (
        <Banner
          title={run.failure.title}
          action={
            <span className={styles.bannerActions}>
              {run.failure.action === "retry" && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    onRetry();
                    focusGenerateButtonIfLost(generateButtonRef);
                  }}
                >
                  重试
                </Button>
              )}
              {run.failure.action === "reload" && (
                <Button
                  variant="secondary"
                  busy={reloadingSource}
                  onClick={() => void onReloadSource().then(() => focusGenerateButtonIfLost(generateButtonRef))}
                >
                  载入最新原文
                </Button>
              )}
              <Button
                variant="plain"
                onClick={() => {
                  generation.reset();
                  focusGenerateButtonIfLost(generateButtonRef);
                }}
              >
                关闭
              </Button>
            </span>
          }
        >
          {run.failure.message} 编辑器保持生成前的内容。
        </Banner>
      )}

      {result && run.kind !== "running" && (
        <GenerationReport result={result} state={resultState} lengthProblems={lengthProblems} previous={run.kind === "failed"} />
      )}
    </section>
  );
}

function IssueList({ issues }: { issues: StructureIssue[] }) {
  return (
    <ul className={styles.issues}>
      {issues.map((issue, i) => (
        // 同一种问题可能出现多次（几个链接都对不上），kind 不唯一；列表只随新的生成整体替换，用下标没问题
        <li key={i}>
          {issue.message}
          {issue.detail && (
            <>
              {" "}
              <code className={styles.detail}>{issue.detail}</code>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

type ReportProps = {
  result: GeneratedResult;
  state: GeneratedState;
  lengthProblems: string[];
  /** 这次生成失败了，下面是上一次成功生成的结果（编辑器里仍是它） */
  previous: boolean;
};

function GenerationReport({ result, state, lengthProblems, previous }: ReportProps) {
  const { errors, warnings } = result.check;
  const modified = state === "modified";
  return (
    <div className={styles.report}>
      <p className={styles.reportHead}>
        {previous && <span>上一次生成的结果</span>}
        <span className={modified ? styles.modified : styles.unmodified}>{state === "none" ? "" : generatedStateLabels[state]}</span>
        <span>
          {modelDisplayName(result.model)} · {formatUsage(result.usage)}
        </span>
      </p>

      {lengthProblems.length > 0 && (
        <div className={`${styles.group} ${styles.errors}`}>
          <p className={styles.groupTitle}>
            <CircleAlert aria-hidden="true" className={styles.errorIcon} />
            译文超出了长度上限，删减之后才能保存
          </p>
          <ul className={styles.issues}>
            {lengthProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div className={`${styles.group} ${styles.errors}`}>
          <p className={styles.groupTitle}>
            <CircleAlert aria-hidden="true" className={styles.errorIcon} />
            {modified
              ? `生成结果有 ${errors.length} 处结构问题（已修改，保存时不再拦截，请确认已经改好）`
              : `结构校验未通过（${errors.length} 处）：机器译文不能直接保存，修正后保存将记为人工译文`}
          </p>
          <IssueList issues={errors} />
        </div>
      )}

      {warnings.length > 0 && (
        <div className={`${styles.group} ${styles.warnings}`}>
          <p className={styles.groupTitle}>
            <TriangleAlert aria-hidden="true" className={styles.warningIcon} />
            请对照原文检查（{warnings.length} 处，不影响保存）
          </p>
          <IssueList issues={warnings} />
        </div>
      )}

      {errors.length === 0 && warnings.length === 0 && lengthProblems.length === 0 && (
        <p className={styles.note}>结构校验通过：代码块、链接、图片地址与原文一致。</p>
      )}
    </div>
  );
}

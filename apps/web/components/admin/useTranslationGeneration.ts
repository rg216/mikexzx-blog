"use client";

import { useEffect, useRef, useState } from "react";
import type { TranslationConfig } from "@blog/shared";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import {
  describeGenerationFailure,
  type FailureDescription,
  GenerationError,
  type GenerationPartial,
  type GenerationProgress,
  type GenerationResult,
  type GenerationSource,
  isWithinStopGrace,
  runTranslationGeneration,
  stepLabel,
} from "@/lib/translation-generation";

export type ConfigState = { kind: "loading" } | { kind: "ready"; config: TranslationConfig } | { kind: "error"; message: string };

/**
 * idle      没在生成
 * running   生成中（progress 是最新进度）
 * stopped   作者点了停止：编辑器保持生成前的内容
 * failed    某一步失败：partial 是已完成的部分，"重试"从失败处继续
 */
export type RunState =
  | { kind: "idle" }
  | { kind: "running"; progress: GenerationProgress }
  | { kind: "stopped" }
  | { kind: "failed"; failure: FailureDescription; partial: GenerationPartial };

/**
 * 译文编辑器里的"生成译文"：读取服务器的翻译配置，跑生成流程（lib/translation-generation.ts），管理停止和失败。
 * 生成的结果不直接写进表单：start() 返回结果，由编辑器决定怎么用（替换标题和正文、记下机器译文的快照）。
 * 生成过程中编辑器的内容保持不变，停止或失败时自然就是"恢复到生成前"，不会有半篇译文留在表单里被误存。
 */
export function useTranslationGeneration() {
  const [config, setConfig] = useState<ConfigState>({ kind: "loading" });
  // 读配置失败（网络抖动、API 冷启动超时）后"重试"：改这个数让下面的 effect 重新请求（同 TranslationEditor 的 reloadKey）
  const [configKey, setConfigKey] = useState(0);
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  /** 这次生成开始的时间（performance.now()），给"停止"的保护期用 */
  const startedAtRef = useRef(0);

  useEffect(() => {
    let ignore = false;
    adminApi.getTranslationConfig().then(
      (next) => {
        if (!ignore) setConfig({ kind: "ready", config: next });
      },
      (error: unknown) => {
        if (!ignore) setConfig({ kind: "error", message: error instanceof AdminApiError ? error.message : "出现了意外错误" });
      },
    );
    return () => {
      ignore = true;
    };
  }, [configKey]);

  // 离开页面（组件卸载）时中止进行中的请求：API 那边随之中止上游的流，不再为没人看的译文付费
  useEffect(() => () => controllerRef.current?.abort(), []);

  /** 开始生成；resume 为 true 时从上次失败处继续。成功返回结果，停止或失败返回 null（状态见 run） */
  async function start(source: GenerationSource, { resume = false } = {}): Promise<GenerationResult | null> {
    if (controllerRef.current) return null;
    const partial = resume && run.kind === "failed" ? run.partial : null;
    const controller = new AbortController();
    controllerRef.current = controller;
    startedAtRef.current = performance.now();
    setRun({ kind: "running", progress: { part: "title", title: null, liveText: "", completedText: "" } });
    try {
      const result = await runTranslationGeneration(adminApi, source, {
        signal: controller.signal,
        resume: partial,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setRun({ kind: "running", progress });
        },
      });
      setRun({ kind: "idle" });
      return result;
    } catch (error) {
      if (error instanceof GenerationError && error.reason === "aborted") {
        setRun({ kind: "stopped" });
      } else if (error instanceof GenerationError) {
        setRun({ kind: "failed", failure: describeGenerationFailure(error.cause, stepLabel(error.step)), partial: error.partial });
      } else {
        setRun({ kind: "failed", failure: describeGenerationFailure(error, "生成译文"), partial: { sourceHash: source.sourceHash, title: null, segments: [] } });
      }
      return null;
    } finally {
      controllerRef.current = null;
    }
  }

  return {
    config,
    run,
    running: run.kind === "running",
    start,
    /**
     * "停止"按钮：中止当前请求，start() 随后以 stopped 结束。开始后 STOP_GRACE_MS 内的点击忽略——
     * 生成和停止是同一个位置的按钮，双击"生成"的第二下不能把刚开始的生成停掉
     */
    stop() {
      if (isWithinStopGrace(startedAtRef.current, performance.now())) return;
      controllerRef.current?.abort();
    },
    /** 立即中止（离开页面时），不管保护期 */
    abort() {
      controllerRef.current?.abort();
    },
    /** 重新读取翻译配置（读取失败后的"重试"） */
    reloadConfig() {
      setConfig({ kind: "loading" });
      setConfigKey((key) => key + 1);
    },
    /** 清掉停止 / 失败的提示（以及失败时保留的已完成部分） */
    reset() {
      if (!controllerRef.current) setRun({ kind: "idle" });
    },
  };
}

export type TranslationGeneration = ReturnType<typeof useTranslationGeneration>;

"use client";

import { type StatusState, type SystemStatus, worstState } from "@blog/shared";
import { CircleAlert, CircleCheck, CircleMinus, CircleX, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import { checkLabels, compareVersions, formatLatency, jobLabels, jobStateLabel, shortVersion, stateLabels } from "@/lib/system-status";
import page from "./SettingsPage.module.css";
import styles from "./StatusView.module.css";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; status: SystemStatus };

const describe = (error: unknown) => (error instanceof AdminApiError ? error.message : "网络错误，请稍后再试");

const icons: Record<StatusState, typeof CircleCheck> = { ok: CircleCheck, warning: CircleAlert, error: CircleX, off: CircleMinus };

/** 状态图标：颜色只是辅助，旁边总有文字（正常 / 注意 / 异常 / 未配置） */
function StateIcon({ state }: { state: StatusState }) {
  const Icon = icons[state];
  return <Icon className={`${styles.icon} ${styles[state]}`} aria-hidden="true" />;
}

/**
 * 状态页：各项依赖配好了没有、现在能不能用，定时任务最近一次的结果，前端和 API 的部署版本。
 * 打开页面时检查一次，"重新检查"再查；不自动轮询（每次检查都会连各个服务，Claude API 的检查也会请求 Anthropic）。
 * webVersion 是前端这次部署的提交号（构建时写进页面），和 API 返回的 version 比较。
 */
export function StatusView({ webVersion }: { webVersion: string | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getStatus()
      .then((status) => {
        if (!cancelled) setState({ kind: "ready", status });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: "error", message: describe(error) });
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  function recheck() {
    setChecking(true);
    setReload((n) => n + 1);
  }

  if (state.kind === "loading") {
    return (
      <div className={page.placeholder} role="status">
        <Spinner />
        <span>正在检查各项服务…</span>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <Banner title="读取状态失败" action={<Button onClick={recheck}>重试</Button>}>
        {state.message}
      </Banner>
    );
  }

  const { status } = state;
  const versions = compareVersions(webVersion, status.version);
  const overall = worstState([...status.checks.map((c) => c.state), ...status.jobs.map((j) => j.state), versions.state]);
  const overallText = overall === "error" ? "有服务异常" : overall === "warning" ? "有需要注意的地方" : "一切正常";

  return (
    <div className={page.sections} aria-busy={checking}>
      <div className={styles.summary}>
        <p className={styles.overall} role="status">
          <StateIcon state={overall === "off" ? "ok" : overall} />
          {checking ? "正在重新检查…" : overallText}
        </p>
        <p className={styles.checkedAt}>
          检查于 <time dateTime={status.checkedAt}>{formatDateTime(status.checkedAt)}</time>
        </p>
        <Button onClick={recheck} busy={checking}>
          {!checking && <RefreshCw className={styles.buttonIcon} aria-hidden="true" />}
          重新检查
        </Button>
      </div>

      <section aria-labelledby="deploy-heading">
        <h2 id="deploy-heading" className={page.sectionTitle}>
          部署版本
        </h2>
        <ul className={`${page.list} ${styles.rows}`}>
          <li className={`${page.item} ${styles.row}`}>
            <StateIcon state={versions.state} />
            <div className={styles.main}>
              <p className={styles.label}>
                前端 <code className={styles.code}>{shortVersion(webVersion)}</code> · API <code className={styles.code}>{shortVersion(status.version)}</code>
              </p>
              <p className={styles.detail}>{versions.summary}</p>
            </div>
          </li>
        </ul>
      </section>

      <section aria-labelledby="checks-heading">
        <h2 id="checks-heading" className={page.sectionTitle}>
          服务
        </h2>
        <p className={page.sectionHint}>只显示配置是否齐全、能否连通，不显示任何密钥或地址。</p>
        <ul className={`${page.list} ${styles.rows}`}>
          {status.checks.map((check) => (
            <li key={check.id} className={`${page.item} ${styles.row}`}>
              <StateIcon state={check.state} />
              <div className={styles.main}>
                <p className={styles.label}>
                  {checkLabels[check.id]}
                  <span className={styles.stateText}>{stateLabels[check.state]}</span>
                </p>
                <p className={styles.detail}>{check.summary}</p>
              </div>
              {check.latencyMs !== null && <span className={styles.latency}>{formatLatency(check.latencyMs)}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="jobs-heading">
        <h2 id="jobs-heading" className={page.sectionTitle}>
          定时任务
        </h2>
        <p className={page.sectionHint}>由 Vercel Cron 调用。超过 26 小时没有成功运行会提示“注意”。</p>
        <ul className={`${page.list} ${styles.rows}`}>
          {status.jobs.map((job) => (
            <li key={job.name} className={`${page.item} ${styles.row}`}>
              <StateIcon state={job.state} />
              <div className={styles.main}>
                <p className={styles.label}>
                  {jobLabels[job.name].name}
                  <span className={styles.stateText}>{jobStateLabel(job.state)}</span>
                </p>
                <p className={styles.detail}>
                  {jobLabels[job.name].schedule}
                  {job.lastRunAt && (
                    <>
                      {" · 上次运行 "}
                      <time dateTime={job.lastRunAt}>{formatDateTime(job.lastRunAt)}</time>
                    </>
                  )}
                  {job.state !== "ok" && job.lastSuccessAt && job.lastSuccessAt !== job.lastRunAt && (
                    <>
                      {" · 上次成功 "}
                      <time dateTime={job.lastSuccessAt}>{formatDateTime(job.lastSuccessAt)}</time>
                    </>
                  )}
                </p>
                {job.detail && <code className={`${styles.code} ${styles.result}`}>{job.detail}</code>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

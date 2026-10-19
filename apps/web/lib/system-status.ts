import type { JobName, StatusCheckId, StatusState, TranslationModel } from "@blog/shared";

/*
 * 后台状态页、模型设置的纯逻辑和文案（不依赖 React，单元测试直接跑）。
 */

/** 各项检查在页面上的名称。Record：shared 里加了检查项，这里会编译报错 */
export const checkLabels: Record<StatusCheckId, string> = {
  database: "数据库",
  migrations: "数据库迁移",
  redis: "Redis（限流、阅读数）",
  storage: "图片存储",
  anthropic: "Claude API（翻译、头图描述）",
  openai: "OpenAI API（头图出图）",
  github: "GitHub 登录（评论）",
  revalidate: "缓存失效通知",
  cron: "定时任务",
};

export const jobLabels: Record<JobName, { name: string; schedule: string }> = {
  "views-flush": { name: "阅读数入库", schedule: "每天 00:10" },
  "images-cleanup": { name: "清理未确认的图片", schedule: "每天 00:20" },
};

export const stateLabels: Record<StatusState, string> = {
  ok: "正常",
  warning: "注意",
  error: "异常",
  off: "未配置",
};

/** 定时任务的状态文字："从未运行"比"未配置"准确（任务接口配好了，只是还没到时间或没被调用过） */
export function jobStateLabel(state: StatusState): string {
  return state === "off" ? "从未运行" : stateLabels[state];
}

/** 提交号只显示前 7 位（和 GitHub 一样）；本地没有提交号 */
export function shortVersion(version: string | null): string {
  return version ? version.slice(0, 7) : "本地";
}

/**
 * 前端和 API 是不是同一次提交部署的。两个 Vercel 项目由同一次推送同时触发，各自构建：
 * 一边还在部署时版本不同；一直不同说明有一边部署失败了。本地（没有提交号）不比较。
 */
export function compareVersions(web: string | null, api: string | null): { state: StatusState; summary: string } {
  if (!web || !api) return { state: "off", summary: "本地运行，没有部署版本可比较" };
  if (web === api) return { state: "ok", summary: `前端和 API 是同一次提交（${shortVersion(web)}）` };
  return { state: "warning", summary: `前端是 ${shortVersion(web)}，API 是 ${shortVersion(api)}：可能有一边还在部署，或部署失败了` };
}

export function formatLatency(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

/** 每百万 token 的价格：$0.1 / $0.5、$2 / $10 */
const usd = (value: number) => `$${value}`;

/** 设置页上模型的价格说明（输入 / 输出，每百万 token） */
export function modelPriceLabel(model: Pick<TranslationModel, "price" | "longPromptPrice">): string {
  const base = `${usd(model.price.input)} / ${usd(model.price.output)}`;
  const long = model.longPromptPrice ? `；提示超过 10 万 token 时 ${usd(model.longPromptPrice.input)} / ${usd(model.longPromptPrice.output)}` : "";
  return `每百万 token：输入 / 输出 ${base}${long}`;
}

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { sha256Hex } from "../auth/tokens.ts";
import type { RedisProvider } from "../redis.ts";
import { errorBody } from "./errors.ts";

export type RateRule = {
  /** 规则名，同时出现在 Redis 键和响应头里 */
  name: string;
  /** 每个窗口允许的请求数 */
  limit: number;
  windowSeconds: number;
  /**
   * Redis 不可用时拒绝（fail-closed），而不是放行。给"每放过一个请求都要花钱"的接口用：
   * 对它们来说限流是唯一的额度上限，Redis 一出故障就不限，等于把上限拿掉了。
   */
  failClosed?: boolean;
};

/** unavailable：限流器没法工作、按 failClosed 拒绝（中间件回 503 而不是 429：不是请求太频繁） */
export type RateDecision = { allowed: boolean; remaining: number; resetSeconds: number; unavailable?: boolean };
export type RateLimiter = (rule: RateRule, key: string) => Promise<RateDecision>;

/** 不限流（没配置 Redis 时用） */
export const unlimited: RateLimiter = async (rule) => ({
  allowed: true,
  remaining: rule.limit,
  resetSeconds: rule.windowSeconds,
});

/**
 * 固定窗口限流：把时间切成长度为 windowSeconds 的格子，每格一个计数器。
 *   INCR 计数 + 首次创建时设置过期（PEXPIRE … NX），放在 MULTI 里原子执行。
 * 比滑动窗口简单，代价是窗口边界处最多可能放过 2 × limit 个请求——对防刷来说足够。
 *
 * Redis 不可用时放行（fail-open）并记日志：登录靠 Passkey，本身不怕暴力破解，
 * 不应该因为 Redis 故障就让人登录不了、写不了文章。例外是 failClosed 的规则（大模型翻译）：拒绝。
 */
export function createRateLimiter(redis: RedisProvider): RateLimiter {
  return async (rule, key) => {
    const now = Date.now();
    const windowMs = rule.windowSeconds * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    // 键里不放原始值（通常是 IP）：只存哈希，Redis 里看不到访客 IP，哪怕只保留一分钟
    const redisKey = `rl:${rule.name}:${sha256Hex(key).slice(0, 32)}:${windowStart}`;
    try {
      const client = await redis();
      const [count] = await client.multi().incr(redisKey).pExpire(redisKey, windowMs, "NX").exec();
      const used = Number(count);
      return {
        allowed: used <= rule.limit,
        remaining: Math.max(0, rule.limit - used),
        resetSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : error;
      if (rule.failClosed) {
        console.warn(`rate limiter unavailable, refusing "${rule.name}" (fail-closed):`, reason);
        return { allowed: false, remaining: 0, resetSeconds: rule.windowSeconds, unavailable: true };
      }
      console.warn(`rate limiter unavailable, allowing "${rule.name}":`, reason);
      return unlimited(rule, key);
    }
  };
}

/**
 * 检查一次限流并设置响应头。响应头遵循 IETF 草案 RateLimit header fields：
 *   RateLimit-Policy: "规则";q=额度;w=窗口秒数    RateLimit: "规则";r=剩余;t=距重置秒数
 * 放行返回 null；超限返回 429 + Retry-After，限流器不可用（failClosed）返回 503。
 * 一般经下面的中间件使用；要在请求校验之后才计数的接口（大模型翻译）在处理函数里直接调用。
 */
export async function checkRateLimit(c: Context, limiter: RateLimiter, rule: RateRule, key: string): Promise<Response | null> {
  const decision = await limiter(rule, key);
  c.header("RateLimit-Policy", `"${rule.name}";q=${rule.limit};w=${rule.windowSeconds}`);
  if (decision.unavailable) {
    return c.json(errorBody("internal_error", "限流服务暂时不可用，这个功能先停用，请稍后再试"), 503);
  }
  c.header("RateLimit", `"${rule.name}";r=${decision.remaining};t=${decision.resetSeconds}`);
  if (!decision.allowed) {
    c.header("Retry-After", String(decision.resetSeconds));
    return c.json(errorBody("rate_limited", "请求太频繁，请稍后再试"), 429);
  }
  return null;
}

/** 限流中间件（见 checkRateLimit） */
export function rateLimit(limiter: RateLimiter, rule: RateRule, keyOf: (c: Context) => string) {
  return createMiddleware(async (c, next) => {
    const refused = await checkRateLimit(c, limiter, rule, keyOf(c));
    if (refused) return refused;
    await next();
  });
}

/** 各接口的限流规则集中放在这里，便于一眼看全 */
export const rules = {
  /** 登录 / 注册 Passkey：按 IP */
  auth: { name: "auth", limit: 20, windowSeconds: 60 },
  /** 后台写操作：按用户（正常编辑远远用不到） */
  adminWrite: { name: "admin-write", limit: 120, windowSeconds: 60 },
  /** 阅读计数：按 IP */
  views: { name: "views", limit: 60, windowSeconds: 60 },
  /** 搜索：按 IP（前端边输入边搜，已做防抖） */
  search: { name: "search", limit: 60, windowSeconds: 60 },
  /** 发评论：按评论者，10 分钟 10 条 */
  comment: { name: "comment", limit: 10, windowSeconds: 600 },
  /**
   * 大模型翻译：按用户，每小时 120 次请求（标题和每一段各算一次）。一篇 20 万字的长文约 35 段，
   * 够一小时内把两三篇长文译成两种语言；主要防脚本失控或 session 泄露后刷掉 API 额度（每次调用都花钱）。
   * 所以 Redis 不可用时拒绝（failClosed）；没配 Redis 时翻译功能整个不启用（见 createApp）。
   */
  translate: { name: "translate", limit: 120, windowSeconds: 3600, failClosed: true },
} satisfies Record<string, RateRule>;

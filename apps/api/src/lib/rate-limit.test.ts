import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRedisProvider } from "../redis.ts";
import { createRateLimiter, type RateRule } from "./rate-limit.ts";

const redis = createRedisProvider(process.env.TEST_REDIS_URL ?? "");
const limiter = createRateLimiter(redis);
const rule: RateRule = { name: "test", limit: 3, windowSeconds: 60 };

beforeEach(async () => (await redis()).flushDb());
afterAll(async () => (await redis()).destroy());

describe("createRateLimiter", () => {
  it("allows up to the limit, then blocks", async () => {
    const decisions = [];
    for (let i = 0; i < 5; i++) decisions.push(await limiter(rule, "ip-1"));
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0, 0]);
    expect(decisions[0]?.resetSeconds).toBeGreaterThan(0);
    expect(decisions[0]?.resetSeconds).toBeLessThanOrEqual(60);
  });

  it("counts keys independently", async () => {
    for (let i = 0; i < 3; i++) await limiter(rule, "ip-1");
    expect((await limiter(rule, "ip-1")).allowed).toBe(false);
    expect((await limiter(rule, "ip-2")).allowed).toBe(true);
    expect((await limiter({ ...rule, name: "other" }, "ip-1")).allowed).toBe(true);
  });

  it("sets an expiry so counters do not pile up in Redis", async () => {
    await limiter(rule, "ip-1");
    const client = await redis();
    const [key] = await client.keys("rl:test:*");
    expect(await client.pTTL(key ?? "")).toBeGreaterThan(0);
  });

  it("starts a fresh window after the old one ends", async () => {
    const short: RateRule = { name: "short", limit: 1, windowSeconds: 1 };
    await limiter(short, "ip-1");
    expect((await limiter(short, "ip-1")).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await limiter(short, "ip-1")).allowed).toBe(true);
  });

  it("fails open when Redis is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = createRateLimiter(async () => {
      throw new Error("connection refused");
    });
    expect(await broken(rule, "ip-1")).toMatchObject({ allowed: true, remaining: 3 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

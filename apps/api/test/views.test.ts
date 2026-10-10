import { viewCountSchema } from "@blog/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { postViews } from "../src/db/schema.ts";
import { siteDay } from "../src/services/views.ts";
import { CRON_SECRET, setupTestApp, WEB_ORIGIN } from "./helpers.ts";

const { db, redis, request, createPost } = setupTestApp({ withRedis: true });

const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";

function view(slug: string, { ua = SAFARI, ip = "203.0.113.1" }: { ua?: string; ip?: string } = {}) {
  return request("POST", `/posts/${slug}/views`, { auth: false, headers: { "user-agent": ua, "x-forwarded-for": ip } });
}
const views = async (res: { body: unknown }) => viewCountSchema.parse(res.body).views;

describe("POST /posts/:slug/views", () => {
  it("counts a visitor once per day", async () => {
    await createPost({ slug: "a", status: "published" });
    expect(await views(await view("a"))).toBe(1);
    expect(await views(await view("a"))).toBe(1); // 同一访客刷新
    expect(await views(await request("GET", "/posts/a/views", { auth: false }))).toBe(1);
  });

  it("counts different visitors separately (IP or browser differs)", async () => {
    await createPost({ slug: "a", status: "published" });
    await view("a");
    await view("a", { ip: "198.51.100.7" });
    expect(await views(await view("a", { ua: CHROME }))).toBe(3);
  });

  it("does not count bots, but still reports the total", async () => {
    await createPost({ slug: "a", status: "published" });
    await view("a");
    expect(await views(await view("a", { ua: "Googlebot/2.1", ip: "66.249.66.1" }))).toBe(1);
  });

  it("keeps separate counts per post", async () => {
    await createPost({ slug: "a", status: "published" });
    await createPost({ slug: "b", status: "published" });
    await view("a");
    expect(await views(await view("b"))).toBe(1);
  });

  it.each([["a draft", "draft-post"], ["a missing post", "nope"], ["an invalid slug", "Bad_Slug"]])("404s for %s", async (_name, slug) => {
    await createPost({ slug: "draft-post" });
    expect((await view(slug)).status).toBe(404);
  });

  it("never stores the visitor's IP or user agent in Redis", async () => {
    await createPost({ slug: "a", status: "published" });
    await view("a", { ip: "203.0.113.99" });
    const client = redis && (await redis());
    const keys = (await client?.keys("*")) ?? [];
    expect(keys.join(" ")).not.toContain("203.0.113.99");
    expect(keys.join(" ")).not.toContain("Safari");
  });

  it("rate-limits by IP and advertises the policy", async () => {
    await createPost({ slug: "a", status: "published" });
    let last = await view("a");
    expect(last.headers.get("ratelimit-policy")).toBe('"views";q=60;w=60');
    for (let i = 1; i < 60; i++) last = await view("a");
    expect(last.status).toBe(200);
    const blocked = await view("a");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: { code: "rate_limited" } });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // 别的 IP 不受影响
    expect((await view("a", { ip: "198.51.100.7" })).status).toBe(200);
  });

  it("requires a same-origin request (CSRF middleware applies to beacons too)", async () => {
    await createPost({ slug: "a", status: "published" });
    const res = await request("POST", "/posts/a/views", { auth: false, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("GET /internal/views/flush", () => {
  const cron = (secret?: string) =>
    request("GET", "/internal/views/flush", { auth: false, headers: secret ? { authorization: `Bearer ${secret}` } : {} });

  it.each([["no secret", undefined], ["a wrong secret", "nope"]])("rejects %s", async (_name, secret) => {
    expect((await cron(secret)).status).toBe(401);
  });

  it("writes yesterday's counts to Postgres, idempotently, skipping deleted posts", async () => {
    const a = await createPost({ slug: "a", status: "published" });
    const b = await createPost({ slug: "b", status: "published" });
    const yesterday = siteDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const client = redis && (await redis());
    await client?.hSet(`views:day:${yesterday}`, { [a.id]: "7", [b.id]: "2", 999: "5" }); // 999 是已删除的文章
    await request("DELETE", `/admin/posts/${b.id}`, { headers: { origin: WEB_ORIGIN } });

    const first = await cron(CRON_SECRET);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ flushed: { [yesterday]: 1 } });
    await cron(CRON_SECRET); // 重复执行

    expect(await db.select().from(postViews).where(eq(postViews.postId, a.id))).toEqual([{ postId: a.id, day: yesterday, views: 7 }]);
    expect(await db.select().from(postViews)).toHaveLength(1);
  });
});

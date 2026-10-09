import type { PostCreateInput } from "@blog/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { createApp } from "../src/create-app.ts";
import { createDb } from "../src/db/client.ts";

export const ADMIN_TOKEN = "test-admin-token-0123456789abcdef0123456789";

/** 每个测试文件调用一次：建连接、组装 app、每个测试前清空数据。 */
export function setupTestApp() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL 未设置");
  const { db, pool } = createDb(url);
  const app = createApp({ db, adminToken: ADMIN_TOKEN });

  beforeEach(async () => {
    // RESTART IDENTITY：自增 id 也从 1 开始，测试里的 id 可预测
    await db.execute(sql`TRUNCATE posts, tags, post_tags RESTART IDENTITY CASCADE`);
  });
  afterAll(() => pool.end());

  /** 用 app.request 直接调用，不需要真的监听端口 */
  async function request(method: string, path: string, options: { body?: unknown; token?: string | null } = {}) {
    const token = options.token === undefined ? ADMIN_TOKEN : options.token;
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as unknown) : null };
  }

  /** 通过 API 创建文章（测试数据也走真实的写入路径） */
  async function createPost(input: Partial<PostCreateInput> & { slug: string }) {
    const res = await request("POST", "/admin/posts", {
      body: { title: input.slug, contentMd: `${input.slug} 的正文。`, ...input },
    });
    if (res.status !== 201) throw new Error(`createPost failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: number; slug: string; publishedAt: string | null };
  }

  return { db, app, request, createPost };
}

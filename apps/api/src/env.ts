import { z } from "zod";
import type { GitHubConfig } from "./auth/github.ts";
import type { StorageConfig } from "./storage.ts";

// 环境变量也是外部输入：启动时校验，缺了或格式不对直接退出，而不是跑到一半才报错。
const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /**
   * 前端的源（协议 + 主机 + 端口），如 https://mikexzx-blog.vercel.app、http://localhost:3000。
   * 它同时决定：WebAuthn 的 origin / RP ID、CSRF 的 Origin 校验、cookie 是否加 Secure。
   */
  WEB_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .transform((value) => new URL(value).origin),
  /**
   * 一次性设置口令：设置后允许不登录就注册 Passkey（首次设置，或所有设备丢失后的恢复）。
   * 用完立即从环境变量里删掉，入口随之关闭。
   */
  ADMIN_SETUP_TOKEN: z.string().min(32, "ADMIN_SETUP_TOKEN 至少 32 个字符（openssl rand -base64 32）").optional(),
  /** 与前端共享的密钥：写入文章后调用前端 /hooks/revalidate 时使用。未设置则不通知（前端靠定时刷新） */
  REVALIDATE_SECRET: z.string().min(32, "REVALIDATE_SECRET 至少 32 个字符（openssl rand -base64 32）").optional(),
  /** Redis（限流、阅读计数），如 redis://localhost:6379、rediss://…upstash.io。未设置则不限流、不计数 */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
  /** 定时任务（每日把阅读数写入 Postgres）的密钥；Vercel Cron 会自动带上同名环境变量 */
  CRON_SECRET: z.string().min(32, "CRON_SECRET 至少 32 个字符").optional(),
  /**
   * 图片的对象存储（S3 协议）。要么全部设置，要么全部不设（不设则后台不能上传图片）。
   * R2：endpoint 为 https://<account>.r2.cloudflarestorage.com，region 用 auto；公开地址是存储桶绑定的域名
   */
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** 评论者的 GitHub 登录（GitHub App 的 Client ID 和 Client secret）。两项都设才启用；不设则评论区只读 */
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});

const storageKeys = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"] as const;

const checkedEnvSchema = envSchema.superRefine((env, ctx) => {
  const missing = storageKeys.filter((key) => !env[key]);
  // 只配了一部分多半是漏填，启动时就报出来，而不是等到上传时才失败
  if (missing.length > 0 && missing.length < storageKeys.length) {
    for (const key of missing) ctx.addIssue({ code: "custom", path: [key], message: "图片存储的配置不完整：S3_* 要么全部设置，要么全部不设" });
  }
  if (Boolean(env.GITHUB_CLIENT_ID) !== Boolean(env.GITHUB_CLIENT_SECRET)) {
    const key = env.GITHUB_CLIENT_ID ? "GITHUB_CLIENT_SECRET" : "GITHUB_CLIENT_ID";
    ctx.addIssue({ code: "custom", path: [key], message: "GitHub 登录的配置不完整：GITHUB_CLIENT_ID 和 GITHUB_CLIENT_SECRET 要一起设置" });
  }
});
export type Env = z.infer<typeof envSchema>;

/** 图片存储的配置；没有配置返回 null */
export function storageConfigFrom(env: Env): StorageConfig | null {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_PUBLIC_URL) return null;
  return {
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    publicUrl: S3_PUBLIC_URL,
  };
}

/** GitHub 登录的配置；没有配置返回 null。回调地址固定为 <前端>/api/auth/github/callback（经前端代理，cookie 才是第一方的） */
export function githubConfigFrom(env: Env): GitHubConfig | null {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return null;
  return { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, redirectUri: `${env.WEB_ORIGIN}/api/auth/github/callback` };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // 去掉首尾空白（从终端复制的值常带结尾换行，如 `openssl rand … | pbcopy`），空字符串当作未设置
  const cleaned = Object.fromEntries(
    Object.entries(source)
      .map(([k, v]) => [k, v?.trim()] as const)
      .filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = checkedEnvSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`环境变量无效：\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

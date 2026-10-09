import { z } from "zod";

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
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});
export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // 去掉首尾空白（从终端复制的值常带结尾换行，如 `openssl rand … | pbcopy`），空字符串当作未设置
  const cleaned = Object.fromEntries(
    Object.entries(source)
      .map(([k, v]) => [k, v?.trim()] as const)
      .filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`环境变量无效：\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

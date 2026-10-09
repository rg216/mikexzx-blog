import { z } from "zod";

// 环境变量也是外部输入：启动时校验，缺了或格式不对直接退出，而不是跑到一半才报错。
const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  ADMIN_TOKEN: z.string().min(32, "ADMIN_TOKEN 至少 32 个字符（openssl rand -base64 32）"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});
export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`环境变量无效：\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

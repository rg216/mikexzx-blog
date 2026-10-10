import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateRequestSchema } from "@blog/shared";
import { revalidateTag } from "next/cache";

/*
 * 按需失效缓存：API 写入文章后调用这里（Bearer REVALIDATE_SECRET + 要失效的缓存标签）。
 * 放在 /hooks 而不是 /api 下：/api/* 已经整体代理给 apps/api 了。
 *
 * 用 { expire: 0 } 而不是推荐的 "max"：
 * "max" 是 stale-while-revalidate，下一个访问者先拿到旧页面、后台再重新生成——
 * 作者保存后立刻打开前台，第一眼看到的还是旧内容，会以为没保存成功。
 * { expire: 0 } 让下一个请求直接拿新内容，代价是那一次请求要等页面生成（零点几秒），小博客完全可以接受。
 */

const sha256 = (value: string) => createHash("sha256").update(value).digest();

function authorized(header: string | null, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  // 常量时间比较，避免通过响应时间逐位猜出密钥
  return Boolean(match?.[1]) && timingSafeEqual(sha256(match?.[1] ?? ""), sha256(secret));
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REVALIDATE_SECRET?.trim();
  if (!secret) return Response.json({ error: "未配置 REVALIDATE_SECRET" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = revalidateRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "请求格式无效" }, { status: 400 });

  for (const tag of parsed.data.tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ revalidated: parsed.data.tags });
}

import { z } from "zod";

/*
 * 调用 apps/api。只在服务端运行（Server Components / 构建时），API_URL 不暴露给浏览器
 * （没有 NEXT_PUBLIC_ 前缀，Next 不会把它打进客户端代码）。
 */

function apiBaseUrl(): string {
  return process.env.API_URL ?? "http://localhost:8787";
}

/**
 * 兜底的定时刷新（秒）：正常情况下 API 写入后会按标签通知前端立即失效（见 app/hooks/revalidate），
 * 这个时间只在通知失败时起作用——最坏情况下前台过时一小时，而不是一直等到下次部署。
 */
export const FALLBACK_REVALIDATE_SECONDS = 3600;

type Options = {
  /** 404 时返回 null（单篇文章不存在是正常情况）；列表接口 404 说明地址配错了，应该报错 */
  notFoundAsNull?: boolean;
  /** 缓存标签（@blog/shared 的 cacheTags）：API 写入后按标签让这份数据失效 */
  tags?: string[];
};

/** GET 一个 JSON 接口并用 schema 校验：API 和前端对不上时，构建直接失败，而不是渲染出错误的数据。 */
export async function apiGet<T extends z.ZodType>(path: string, schema: T, options: Options & { notFoundAsNull: true }): Promise<z.output<T> | null>;
export async function apiGet<T extends z.ZodType>(path: string, schema: T, options?: Options): Promise<z.output<T>>;
export async function apiGet<T extends z.ZodType>(path: string, schema: T, options: Options = {}): Promise<z.output<T> | null> {
  const url = new URL(path, apiBaseUrl());

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      // 进入 Next 的数据缓存：页面按 ISR 缓存，按标签失效，或到点后台刷新
      next: { revalidate: FALLBACK_REVALIDATE_SECONDS, tags: options.tags ?? [] },
    });
  } catch (error) {
    throw new Error(`无法连接 API ${url.origin}：API 启动了吗？API_URL 配置对吗？`, { cause: error });
  }

  if (res.status === 404 && options.notFoundAsNull) return null;
  if (!res.ok) throw new Error(`API ${url.pathname} 返回 ${res.status}`);

  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`API ${url.pathname} 的响应不符合 @blog/shared 的约定：\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

import { z } from "zod";

/*
 * 调用 apps/api。只在服务端运行（Server Components / 构建时），API_URL 不暴露给浏览器
 * （没有 NEXT_PUBLIC_ 前缀，Next 不会把它打进客户端代码）。
 */

function apiBaseUrl(): string {
  return process.env.API_URL ?? "http://localhost:8787";
}

type Options = {
  /** 404 时返回 null（单篇文章不存在是正常情况）；列表接口 404 说明地址配错了，应该报错 */
  notFoundAsNull?: boolean;
};

/** GET 一个 JSON 接口并用 schema 校验：API 和前端对不上时，构建直接失败，而不是渲染出错误的数据。 */
export async function apiGet<T extends z.ZodType>(path: string, schema: T, options: { notFoundAsNull: true }): Promise<z.output<T> | null>;
export async function apiGet<T extends z.ZodType>(path: string, schema: T, options?: Options): Promise<z.output<T>>;
export async function apiGet<T extends z.ZodType>(path: string, schema: T, options: Options = {}): Promise<z.output<T> | null> {
  const url = new URL(path, apiBaseUrl());

  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
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

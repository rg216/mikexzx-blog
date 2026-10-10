import { cacheTags, type PostStatus } from "@blog/shared";

/** 通知前端让一组缓存标签失效。实现必须吞掉错误：通知失败不能让写入失败。 */
export type Revalidator = (tags: string[]) => Promise<void>;

export const noopRevalidator: Revalidator = async () => {};

/**
 * 调用前端的 /hooks/revalidate。
 * 等待结果（而不是"发出去就不管"）：Serverless 函数在返回响应后可能被立即冻结，后台请求会丢；
 * 但最多等 timeoutMs，失败只记日志——前端还有一小时的定时刷新兜底。
 */
export function createRevalidator({
  url,
  secret,
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = 3000,
}: {
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Revalidator {
  return async (tags) => {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) console.warn(`revalidate ${url} returned ${res.status} for`, tags);
    } catch (error) {
      console.warn(`revalidate ${url} failed for`, tags, error);
    }
  };
}

type PublicState = { slug: string; status: PostStatus } | null;

/**
 * 一次写入影响了哪些前台缓存。传入写入前、写入后的状态（新建时前者为 null，删除时后者为 null）。
 * 只要有一边是已发布，前台就可能变了；两边都是草稿则前台看不到任何变化，不用通知。
 * slug 改了的话新旧两个都要失效：旧地址应该变成 404。
 */
export function tagsForChange(before: PublicState, after: PublicState): string[] {
  const versions = [before, after].filter((v) => v !== null);
  if (!versions.some((v) => v.status === "published")) return [];
  const slugs = new Set(versions.map((v) => v.slug));
  return [cacheTags.posts, ...[...slugs].map((slug) => cacheTags.post(slug))];
}

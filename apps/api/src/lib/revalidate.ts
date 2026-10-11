import { cacheTags, type Locale, locales, type PostStatus, REVALIDATE_MAX_TAGS } from "@blog/shared";

/** 通知前端让一组缓存标签失效。实现必须吞掉错误：通知失败不能让写入失败。 */
export type Revalidator = (tags: string[]) => Promise<void>;

export const noopRevalidator: Revalidator = async () => {};

/**
 * 调用前端的 /hooks/revalidate。
 * 等待结果（而不是"发出去就不管"）：Serverless 函数在返回响应后可能被立即冻结，后台请求会丢；
 * 但最多等 timeoutMs，失败只记日志——前端还有一小时的定时刷新兜底。
 * 标签多于 REVALIDATE_MAX_TAGS（如改名的标签被几十篇文章用到）时分批并行发送，总耗时仍不超过 timeoutMs。
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
  async function send(tags: string[]) {
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
  }

  return async (tags) => {
    const unique = [...new Set(tags)];
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += REVALIDATE_MAX_TAGS) batches.push(unique.slice(i, i + REVALIDATE_MAX_TAGS));
    await Promise.all(batches.map(send));
  };
}

type PublicState = { slug: string; status: PostStatus } | null;

/**
 * 原文的一次写入影响了哪些前台缓存。传入写入前、写入后的状态（新建时前者为 null，删除时后者为 null）。
 * 只要有一边是已发布，前台就可能变了；两边都是草稿则前台看不到任何变化，不用通知。
 * slug 改了的话新旧两个都要失效：旧地址应该变成 404。
 * 原文变化影响所有语言的页面（标签、日期、可见性、"原文已更新"提示、hreflang 都来自原文），所以每种语言都要失效。
 */
export function tagsForChange(before: PublicState, after: PublicState): string[] {
  const versions = [before, after].filter((v) => v !== null);
  if (!versions.some((v) => v.status === "published")) return [];
  const slugs = new Set(versions.map((v) => v.slug));
  return [...locales.map((locale) => cacheTags.posts(locale)), ...[...slugs].flatMap((slug) => locales.map((locale) => cacheTags.post(slug, locale)))];
}

/**
 * 保存 / 删除一篇译文影响了哪些前台缓存。草稿的译文读者看不到，不用通知。
 * 该语言的列表和文章页一定要失效；译文"从无到有"或"从有到无"时，其他语言的文章页也要失效：
 * 它们的 hreflang 和切换语言菜单里多了 / 少了这种语言。只是修改已有译文时，其他语言的页面不变。
 */
export function tagsForTranslationChange({
  slug,
  status,
  locale,
  existedBefore,
  existsAfter,
}: {
  slug: string;
  status: PostStatus;
  locale: Locale;
  existedBefore: boolean;
  existsAfter: boolean;
}): string[] {
  if (status !== "published") return [];
  const others = existedBefore !== existsAfter ? locales.filter((l) => l !== locale).map((l) => cacheTags.post(slug, l)) : [];
  return [cacheTags.posts(locale), cacheTags.post(slug, locale), ...others];
}

/**
 * 一批已发布文章显示的内容变了（如它们用的标签改名了）：每种语言的列表和这些文章页都要失效（标签所有语言共用）。
 * 传入的应只含已发布文章。
 */
export function tagsForPublishedPosts(slugs: string[]): string[] {
  if (slugs.length === 0) return [];
  return [...locales.map((locale) => cacheTags.posts(locale)), ...[...new Set(slugs)].flatMap((slug) => locales.map((locale) => cacheTags.post(slug, locale)))];
}

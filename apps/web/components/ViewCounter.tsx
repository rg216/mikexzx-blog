"use client";

import { viewCountSchema } from "@blog/shared";
import { useEffect, useState } from "react";

const numberFormat = new Intl.NumberFormat("zh-CN");

/**
 * 阅读数：页面加载后上报一次阅读并取回总数（同一访客一天只计一次，见 apps/api 的 views 服务）。
 * 不写进 ISR 的 HTML——否则每多一次阅读就得重新生成页面。拿到数字之前、或服务端没配 Redis 时不显示。
 */
export function ViewCounter({ slug }: { slug: string }) {
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // keepalive：用户很快离开页面时请求也能发完
    fetch(`/api/posts/${encodeURIComponent(slug)}/views`, { method: "POST", keepalive: true, signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        const parsed = viewCountSchema.safeParse(json);
        if (parsed.success && parsed.data.views !== null) setViews(parsed.data.views);
      })
      .catch(() => {
        // 计数失败不影响阅读，静默忽略
      });
    return () => controller.abort();
  }, [slug]);

  if (views === null) return null;
  return <span>{numberFormat.format(views)} 次阅读</span>;
}

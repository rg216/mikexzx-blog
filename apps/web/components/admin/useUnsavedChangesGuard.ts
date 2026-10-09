"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * 有未保存的修改时拦住离开页面：
 *   - 关闭标签页、刷新、跳到站外：beforeunload，浏览器弹自己的确认框（文案不可定制）
 *   - 站内链接（next/link 的客户端跳转不会触发 beforeunload）：
 *     在 window 的捕获阶段拦截点击，先于 React 的事件处理，next/link 就不会开始跳转；
 *     然后由页面内的对话框确认，确认后再用 router.push 跳过去。
 *
 * 已知的缺口：浏览器的后退 / 前进按钮。App Router 没有提供可取消的路由事件，
 * 用 popstate 硬拦需要往历史栈里塞假记录，副作用比收益大，所以这里不处理。
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // 标准做法是 preventDefault；旧版 Safari 还需要设置 returnValue 才会弹框
      event.returnValue = true;
    }

    function onClick(event: MouseEvent) {
      // 修饰键 / 中键：用户要在新标签页打开，当前页面不受影响
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;

      const url = new URL(anchor.href);
      // 站外链接交给 beforeunload；同页锚点不算离开
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, { capture: true });
    };
  }, [dirty]);

  return {
    /** 被拦下的目标地址；非 null 时应显示确认对话框 */
    pendingHref,
    /** 放弃修改，继续跳转 */
    confirmLeave() {
      if (pendingHref) router.push(pendingHref);
      setPendingHref(null);
    },
    /** 留在当前页面 */
    cancelLeave() {
      setPendingHref(null);
    },
  };
}

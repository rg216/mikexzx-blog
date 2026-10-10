"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import styles from "./AdminNav.module.css";

/** 导航栏"评论"旁的待审核数。切换页面时刷新一次（审核完回到别的页面，数字随之更新） */
export function PendingCommentsBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    adminApi.pendingCommentCount().then(
      (n) => !ignore && setCount(n),
      () => {
        // 拿不到数字就不显示，不影响导航
      },
    );
    return () => {
      ignore = true;
    };
  }, [pathname]);

  if (count === 0) return null;
  return (
    <span className={styles.count}>
      {count > 99 ? "99+" : count}
      <span className="visually-hidden"> 条待审核</span>
    </span>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";

// 后台页面不进搜索引擎。放在这一层而不是 app/admin/layout.tsx：那个文件归登录 / session 部分管，
// 两边都声明也没关系——Next 合并 metadata 时以更深的一层为准，值是一样的。
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminPostsLayout({ children }: { children: ReactNode }) {
  return children;
}

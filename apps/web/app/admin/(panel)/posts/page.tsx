import type { Metadata } from "next";
import { PostList } from "@/components/admin/PostList";

export const metadata: Metadata = { title: "文章管理" };

// 页面本身是静态外壳，数据在浏览器里带着 session cookie 请求 /api/admin/posts
export default function AdminPostsPage() {
  return <PostList />;
}

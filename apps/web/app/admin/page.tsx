import { redirect } from "next/navigation";

// /admin 本身没有内容，直接进文章列表（未登录时由 SessionGate 再转去登录页）
export default function AdminIndex() {
  redirect("/admin/posts");
}

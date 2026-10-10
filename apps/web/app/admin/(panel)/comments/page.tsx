import type { Metadata } from "next";
import { CommentModeration } from "@/components/admin/CommentModeration";

export const metadata: Metadata = { title: "评论管理" };

export default function AdminCommentsPage() {
  return <CommentModeration />;
}

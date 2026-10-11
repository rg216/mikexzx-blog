import type { Metadata } from "next";
import { TagManager } from "@/components/admin/TagManager";

export const metadata: Metadata = { title: "标签管理" };

export default function AdminTagsPage() {
  return <TagManager />;
}

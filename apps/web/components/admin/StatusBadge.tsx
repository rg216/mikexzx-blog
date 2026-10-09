import type { PostStatus } from "@blog/shared";
import { Badge } from "@/components/ui/Badge";

export const statusLabels: Record<PostStatus, string> = { draft: "草稿", published: "已发布" };

export function StatusBadge({ status }: { status: PostStatus }) {
  return <Badge tone={status === "published" ? "success" : "neutral"}>{statusLabels[status]}</Badge>;
}

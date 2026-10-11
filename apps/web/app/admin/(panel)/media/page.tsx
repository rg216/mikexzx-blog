import type { Metadata } from "next";
import { MediaLibrary } from "@/components/admin/media/MediaLibrary";

export const metadata: Metadata = { title: "媒体库" };

export default function AdminMediaPage() {
  return <MediaLibrary />;
}

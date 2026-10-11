import { notFound } from "next/navigation";

/*
 * /admin 下没有匹配任何页面的网址：交给 admin/not-found.tsx，在后台自己的根布局里显示 404。
 * 没有 app/layout.tsx 之后，未匹配的网址否则会落到 Next 内置的 404 页面（没有站点样式）。
 */
export default function AdminCatchAll() {
  notFound();
}

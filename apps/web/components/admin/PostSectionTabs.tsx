import { SectionTabs } from "./SectionTabs";

const sections = [
  { href: "/admin/posts", label: "文章" },
  { href: "/admin/posts/tags", label: "标签" },
] as const;

/** "文章"栏目下的二级导航：文章列表 / 标签管理。标签只为文章服务，放在文章下面 */
export function PostSectionTabs() {
  return <SectionTabs label="文章管理" sections={sections} />;
}

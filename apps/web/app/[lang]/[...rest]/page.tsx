import { notFound } from "next/navigation";

/*
 * 兜底：[lang] 下没有匹配任何页面的网址（/en/nope、被 rewrite 成 /zh/nope 的 /nope）都到这里，
 * 由同一语言的 not-found.tsx 显示，导航栏、<html lang> 和 404 文案都是该语言的。
 * 没有它的话，未匹配的网址会落到 Next 内置的 404（没有根布局可用，样式和语言都不对）。
 */
export default function CatchAll() {
  notFound();
}

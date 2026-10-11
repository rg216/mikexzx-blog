import { defaultLocale, isLocale } from "@blog/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { lang } from "next/root-params";
import { getDictionary } from "@/lib/i18n";
import { localePath } from "@/lib/i18n/paths";
import styles from "./not-found.module.css";

/** not-found 拿不到 params：用 next/root-params 读根布局的 [lang] */
async function currentLocale() {
  const value = await lang();
  return value && isLocale(value) ? value : defaultLocale;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: getDictionary(await currentLocale()).notFound.title };
}

export default async function NotFound() {
  const locale = await currentLocale();
  const t = getDictionary(locale).notFound;
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t.title}</h1>
      <p className={styles.text}>{t.text}</p>
      <Link href={localePath(locale, "/")} className={styles.link}>
        {t.home}
      </Link>
    </div>
  );
}

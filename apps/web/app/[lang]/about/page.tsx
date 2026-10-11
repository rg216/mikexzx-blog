import type { Metadata } from "next";
import prose from "@/components/Prose.module.css";
import { getDictionary } from "@/lib/i18n";
import { pageAlternates } from "@/lib/i18n/alternates";
import { requireLocale } from "@/lib/i18n/params";
import styles from "./page.module.css";

export async function generateMetadata({ params }: PageProps<"/[lang]/about">): Promise<Metadata> {
  const locale = requireLocale((await params).lang);
  return { title: getDictionary(locale).about.title, alternates: pageAlternates(locale, "/about") };
}

export default async function AboutPage({ params }: PageProps<"/[lang]/about">) {
  const t = getDictionary(requireLocale((await params).lang)).about;
  return (
    <article>
      <h1 className={styles.title}>{t.title}</h1>
      <div className={prose.prose}>
        {t.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </article>
  );
}

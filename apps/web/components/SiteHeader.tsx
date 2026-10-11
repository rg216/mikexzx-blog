import type { Locale } from "@blog/shared";
import { Search } from "lucide-react";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { localePath } from "@/lib/i18n/paths";
import { site } from "@/lib/site";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { NavLink } from "./NavLink";
import styles from "./SiteHeader.module.css";

export function SiteHeader({ locale }: { locale: Locale }) {
  const t = getDictionary(locale).nav;

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link href={localePath(locale, "/")} className={styles.brand}>
          {site.name}
        </Link>
        <div className={styles.actions}>
          <nav aria-label={t.label}>
            <ul className={styles.links}>
              <li>
                <NavLink href={localePath(locale, "/")}>{t.posts}</NavLink>
              </li>
              <li>
                <NavLink href={localePath(locale, "/about")}>{t.about}</NavLink>
              </li>
              <li>
                {/* 只显示图标；文字留给读屏（链接必须有可读的名称） */}
                <NavLink href={localePath(locale, "/search")}>
                  <Search className={styles.icon} aria-hidden="true" />
                  <span className="visually-hidden">{t.search}</span>
                </NavLink>
              </li>
            </ul>
          </nav>
          {/* 切换语言不是站内导航，放在 <nav> 外面 */}
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}

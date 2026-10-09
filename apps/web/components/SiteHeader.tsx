import Link from "next/link";
import { site } from "@/lib/site";
import { NavLink } from "./NavLink";
import styles from "./SiteHeader.module.css";

export function SiteHeader() {
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          {site.name}
        </Link>
        <nav aria-label="主导航">
          <ul className={styles.links}>
            <li>
              <NavLink href="/">文章</NavLink>
            </li>
            <li>
              <NavLink href="/about">关于</NavLink>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

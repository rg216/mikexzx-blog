import { site } from "@/lib/site";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <p className={styles.inner}>
        © {new Date().getFullYear()} {site.name}
      </p>
    </footer>
  );
}

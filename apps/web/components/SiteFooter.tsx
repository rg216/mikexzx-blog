import { site } from "@/lib/site";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p>
          © {new Date().getFullYear()} {site.name}
        </p>
        {/* 只用纯文字署名，不用 Claude / Anthropic 的 logo：
            Anthropic 没有公开授权的徽章，商标规范要求 logo 使用须事先书面许可。
            https://www.anthropic.com/legal/trademark-guidelines */}
        <p>
          Created with{" "}
          <a href="https://claude.com" className={styles.link}>
            Claude
          </a>
        </p>
      </div>
    </footer>
  );
}

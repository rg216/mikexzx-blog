import { describe, expect, it } from "vitest";
import { ogBase, siteUrl } from "./root-metadata";
import { site } from "./site";

describe("siteUrl", () => {
  it("uses SITE_URL when it is a valid http(s) URL", () => {
    expect(siteUrl("https://blog.example.com").href).toBe("https://blog.example.com/");
    expect(siteUrl(" http://localhost:3000 ").href).toBe("http://localhost:3000/");
  });

  it.each([undefined, "", "not a url", "javascript:alert(1)", "ftp://example.com"])("falls back to the production URL for %j", (value) => {
    expect(siteUrl(value).href).toBe("https://mikexzx-blog.vercel.app/");
  });
});

describe("ogBase", () => {
  it("includes the site name, so pages that override openGraph keep og:site_name", () => {
    expect(ogBase("zh").siteName).toBe(site.name);
  });

  it("uses the Open Graph language_TERRITORY form, not the BCP 47 tag", () => {
    expect(ogBase("zh").locale).toBe("zh_CN");
    expect(ogBase("en").locale).toBe("en_US");
    expect(ogBase("ja").locale).toBe("ja_JP");
  });
});

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";
import { sizesFor } from "./rehype-images";

const url = "https://pub-x.r2.dev/images/2026/10/AbCdEfGh_jKlMn-p.jpg";
const images = { "images/2026/10/AbCdEfGh_jKlMn-p.jpg": { width: 2560, height: 1920, variants: [640, 1280] } };

describe("rehypeImages", () => {
  it("adds dimensions, srcset and sizing hints to library images", async () => {
    const html = await renderMarkdown(`![海边](${url} "日落")`, { images });
    expect(html).toContain('width="2560" height="1920"');
    expect(html).toContain(`srcset="${url.replace(".jpg", "-640w.jpg")} 640w, ${url.replace(".jpg", "-1280w.jpg")} 1280w, ${url} 2560w"`);
    expect(html).toContain('sizes="(min-width: 46rem) 864px, 100vw"');
    expect(html).toContain('style="--image-max: 2560px; --image-ratio: 2560 / 1920"');
    expect(html).toContain("<figcaption>日落</figcaption>");
  });

  it("reads the display size from the fragment, strips it, and marks the figure", async () => {
    const html = await renderMarkdown(`![](${url}#small)`, { images });
    expect(html).toContain(`src="${url}"`);
    expect(html).toContain('<figure data-size="small">');
    expect(html).toContain('sizes="340px"');
  });

  it("supports custom widths", async () => {
    const html = await renderMarkdown(`![](${url}#w=480)`, { images });
    expect(html).toContain('data-size="custom"');
    expect(html).toContain("--display-max: 480px");
    expect(html).toContain('sizes="(min-width: 480px) 480px, 100vw"');
  });

  it("only applies the size to images it knows nothing about", async () => {
    const html = await renderMarkdown("![](https://elsewhere.example/a.png#medium)");
    expect(html).toContain('src="https://elsewhere.example/a.png"');
    expect(html).toContain('data-size="medium"');
    expect(html).not.toContain("srcset");
    expect(html).not.toContain("width=");
  });

  it("does not let a crafted fragment reach the style or split the srcset", async () => {
    const html = await renderMarkdown(`![](${url}#w=1;background:red,https://evil.example/x.jpg%202x)`, { images });
    expect(/style="([^"]*)"/.exec(html)?.[1]).toBe("--image-max: 2560px; --image-ratio: 2560 / 1920");
    expect(/srcset="([^"]*)"/.exec(html)?.[1]).not.toContain("evil");
  });
});

describe("sizesFor", () => {
  it("assumes figures are large and inline images are as wide as the text", () => {
    expect(sizesFor(null, true)).toBe("(min-width: 46rem) 864px, 100vw");
    expect(sizesFor(null, false)).toBe("(min-width: 46rem) 680px, 100vw");
  });
});

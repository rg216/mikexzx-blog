import { postUpdateInputSchema } from "@blog/shared";
import { describe, expect, it } from "vitest";
import {
  buildUpdateInput,
  coverFromImage,
  isFormDirty,
  issuesToFormErrors,
  normalizeSlug,
  type PostFormValues,
  suggestSlug,
  validatePostForm,
} from "./post-form";

const initial: PostFormValues & { status: "draft" } = {
  title: "标题",
  slug: "title",
  contentMd: "正文",
  tags: [{ slug: "web", name: "Web", locale: "zh" }],
  cover: null,
  status: "draft",
};

describe("buildUpdateInput", () => {
  it("returns null when nothing changed (the API rejects an empty PATCH)", () => {
    expect(buildUpdateInput(initial, { ...initial }, "draft")).toBeNull();
  });

  it("includes only changed fields", () => {
    const input = buildUpdateInput(initial, { ...initial, contentMd: "新正文" }, "draft");
    expect(input).toEqual({ contentMd: "新正文" });
    expect(postUpdateInputSchema.safeParse(input).success).toBe(true);
  });

  it("includes status when publishing, even without content changes", () => {
    expect(buildUpdateInput(initial, { ...initial }, "published")).toEqual({ status: "published" });
  });

  it("sends tag slugs when tags are added, removed or reordered, but not for an equal copy", () => {
    const two = [
      { slug: "a", name: "A", locale: "zh" as const },
      { slug: "b", name: "B", locale: "zh" as const },
    ];
    const base = { ...initial, tags: two };
    expect(buildUpdateInput(base, { ...base, tags: two.map((t) => ({ ...t })) }, "draft")).toBeNull();
    expect(buildUpdateInput(base, { ...base, tags: [...two].reverse() }, "draft")).toEqual({ tags: ["b", "a"] });
    expect(buildUpdateInput(base, { ...base, tags: [] }, "draft")).toEqual({ tags: [] });
    // 名称在标签管理页改，编辑器里不算文章的改动
    expect(buildUpdateInput(base, { ...base, tags: [{ slug: "a", name: "A2", locale: "zh" as const }, two[1]!] }, "draft")).toBeNull();
  });
});

describe("cover", () => {
  const cover = { url: "https://img.test/images/2026/10/AbCdEfGh_jKlMn-p.jpg", alt: "", width: 100, height: 50, variants: [] };

  it("sends only the cover's address when it changes, and null when removed", () => {
    expect(buildUpdateInput(initial, { ...initial, cover }, "draft")).toEqual({ coverImage: cover.url });
    expect(buildUpdateInput({ ...initial, cover }, { ...initial, cover: null }, "draft")).toEqual({ coverImage: null });
    // 同一张图（对象不同）不算改动
    expect(buildUpdateInput({ ...initial, cover }, { ...initial, cover: { ...cover } }, "draft")).toBeNull();
    expect(isFormDirty(initial, { ...initial, cover })).toBe(true);
  });

  it("takes the alt and sizes from the media library", () => {
    const image = { id: 1, url: cover.url, contentType: "image/jpeg" as const, size: 1, filename: "a.jpg", width: null, height: null, variants: [640], folderId: null, description: "海边", usage: 0, createdAt: "2026-10-01T00:00:00.000Z" };
    expect(coverFromImage(image)).toEqual({ url: cover.url, alt: "海边", width: null, height: null, variants: [] });
    expect(coverFromImage({ ...image, width: 1280, height: 640 })).toMatchObject({ width: 1280, height: 640, variants: [640] });
  });
});

describe("isFormDirty", () => {
  it("detects any field change", () => {
    expect(isFormDirty(initial, { ...initial })).toBe(false);
    expect(isFormDirty(initial, { ...initial, title: "标题 " })).toBe(true);
    expect(isFormDirty(initial, { ...initial, tags: [] })).toBe(true);
  });
});

describe("issuesToFormErrors", () => {
  it("maps API paths to form fields and keeps the first message per field", () => {
    expect(
      issuesToFormErrors([
        { path: "slug", message: "格式不对" },
        { path: "slug", message: "太长" },
        { path: "tags.1", message: '标签 "gone" 不存在' },
        { path: "", message: "至少需要更新一个字段" },
      ]),
    ).toEqual({ slug: "格式不对", tags: '第 2 个标签：标签 "gone" 不存在', form: "至少需要更新一个字段" });
  });
});

describe("validatePostForm", () => {
  it("uses the shared schema", () => {
    expect(validatePostForm(initial, "draft")).toEqual({});
    const errors = validatePostForm({ ...initial, title: "  ", slug: "Bad Slug" }, "draft");
    // title 会先 trim，空白标题等于没填
    expect(errors.title).toBe("请填写标题");
    // schema 里自定义的信息原样保留
    expect(errors.slug).toBe("slug 只能包含小写字母、数字和单个连字符");
  });

  it("translates length errors into specific Chinese messages", () => {
    const errors = validatePostForm(
      { ...initial, title: "长".repeat(201), tags: Array.from({ length: 21 }, (_, i) => ({ slug: `t${i}`, name: `T${i}`, locale: "zh" as const })) },
      "draft",
    );
    expect(errors.title).toBe("标题不能超过 200 个字符");
    expect(errors.tags).toBe("标签最多 20 个");
  });
});

describe("normalizeSlug", () => {
  it.each([
    ["Hello World", "hello-world"],
    ["  next_js  16 ", "next-js-16"],
    ["--a--b--", "a-b"],
    ["Ｎｅｘｔ．ｊｓ", "nextjs"],
    ["Café", "cafe"],
    ["中文", ""],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });
});

describe("suggestSlug", () => {
  it("extracts latin words and digits from a mixed title", () => {
    expect(suggestSlug("用 Hono 写 API：第 2 部分")).toBe("hono-api-2");
  });

  it("falls back to the local date for a title without latin characters", () => {
    expect(suggestSlug("春天的第一篇文章", new Date(2026, 2, 5))).toBe("2026-03-05");
  });
});

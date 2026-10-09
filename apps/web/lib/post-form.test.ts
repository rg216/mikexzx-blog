import { postUpdateInputSchema } from "@blog/shared";
import { describe, expect, it } from "vitest";
import {
  buildUpdateInput,
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
  tags: [{ slug: "web", name: "Web" }],
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

  it("treats tag edits, reordering and renames as changes, but not an equal copy", () => {
    const two = [
      { slug: "a", name: "A" },
      { slug: "b", name: "B" },
    ];
    const base = { ...initial, tags: two };
    expect(buildUpdateInput(base, { ...base, tags: two.map((t) => ({ ...t })) }, "draft")).toBeNull();
    expect(buildUpdateInput(base, { ...base, tags: [...two].reverse() }, "draft")).toEqual({ tags: [...two].reverse() });
    expect(buildUpdateInput(base, { ...base, tags: [{ slug: "a", name: "A2" }, two[1]!] }, "draft")).toHaveProperty("tags");
    expect(buildUpdateInput(base, { ...base, tags: [] }, "draft")).toEqual({ tags: [] });
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
        { path: "tags.1.name", message: "不能为空" },
        { path: "", message: "至少需要更新一个字段" },
      ]),
    ).toEqual({ slug: "格式不对", tags: "第 2 个标签：不能为空", form: "至少需要更新一个字段" });
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
      { ...initial, title: "长".repeat(201), tags: [{ slug: "ok", name: "" }] },
      "draft",
    );
    expect(errors.title).toBe("标题不能超过 200 个字符");
    expect(errors.tags).toBe("第 1 个标签：请填写名称");
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

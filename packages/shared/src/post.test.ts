import { describe, expect, it } from "vitest";
import {
  adminPostSchema,
  adminTranslationSchema,
  listPostsQuerySchema,
  postCreateInputSchema,
  postSchema,
  postSummarySchema,
  postUpdateInputSchema,
  publicPostSchema,
  slugSchema,
  sourceHashSchema,
  translationInputSchema,
} from "./post.ts";

describe("slugSchema", () => {
  it.each(["hello", "hello-world", "v0-2026"])("accepts %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it.each(["", "Hello", "hello--world", "-hello", "hello-", "你好", "a b"])("rejects %j", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });
});

describe("postSchema", () => {
  const base = {
    slug: "hello",
    title: "Hello",
    contentMd: "# Hi",
    excerpt: "Hi",
    status: "published",
    publishedAt: "2026-10-01T09:00:00+08:00",
    tags: [],
    images: { "images/2026/10/AbCdEfGh_jKlMn-p.jpg": { width: 2560, height: 1920, variants: [640, 1280] } },
    locale: "zh",
  };

  it("accepts a valid post", () => {
    expect(postSchema.parse(base)).toEqual(base);
  });

  it("rejects a non-ISO publishedAt", () => {
    expect(postSchema.safeParse({ ...base, publishedAt: "2026/10/01" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(postSchema.safeParse({ ...base, status: "archived" }).success).toBe(false);
  });

  it("requires a supported locale", () => {
    expect(postSchema.safeParse({ ...base, locale: undefined }).success).toBe(false);
    expect(postSchema.safeParse({ ...base, locale: "fr" }).success).toBe(false);
  });

  it("keeps the locale in summaries", () => {
    expect(postSummarySchema.parse(base)).toMatchObject({ locale: "zh" });
  });
});

const hash = "a".repeat(64);

describe("publicPostSchema", () => {
  const post = {
    slug: "hello",
    title: "Hello",
    contentMd: "Hi",
    excerpt: "Hi",
    status: "published",
    publishedAt: "2026-10-01T09:00:00+08:00",
    tags: [],
    images: {},
    locale: "en",
    sourceLocale: "zh",
    availableLocales: ["zh", "en"],
    translation: { origin: "human", translatedAt: "2026-10-02T09:00:00.000Z", outdated: false },
  };

  it("accepts a translated post and an original (translation: null)", () => {
    expect(publicPostSchema.parse(post)).toEqual(post);
    expect(publicPostSchema.safeParse({ ...post, locale: "zh", translation: null }).success).toBe(true);
  });

  it("rejects unknown origins and languages", () => {
    expect(publicPostSchema.safeParse({ ...post, translation: { ...post.translation, origin: "ai" } }).success).toBe(false);
    expect(publicPostSchema.safeParse({ ...post, availableLocales: ["zh", "fr"] }).success).toBe(false);
  });
});

describe("adminPostSchema / adminTranslationSchema", () => {
  const translation = {
    locale: "ja",
    title: "タイトル",
    origin: "machine",
    model: "claude-x",
    translatedAt: "2026-10-02T09:00:00.000Z",
    sourceHash: hash,
    outdated: true,
  };

  it("accepts a post with translation summaries", () => {
    const post = {
      slug: "hello",
      title: "你好",
      contentMd: "正文",
      excerpt: "正文",
      status: "draft",
      publishedAt: null,
      tags: [],
      images: {},
      locale: "zh",
      id: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      sourceLocale: "zh",
      sourceHash: hash,
      translations: [translation],
    };
    expect(adminPostSchema.parse(post)).toEqual(post);
    expect(adminPostSchema.safeParse({ ...post, sourceHash: "x" }).success).toBe(false);
  });

  it("adds the content to a full translation", () => {
    expect(adminTranslationSchema.safeParse(translation).success).toBe(false);
    expect(adminTranslationSchema.safeParse({ ...translation, contentMd: "本文", excerpt: "本文" }).success).toBe(true);
  });
});

describe("sourceHashSchema", () => {
  it.each([["a".repeat(64)], ["0123456789abcdef".repeat(4)]])("accepts %s", (value) => {
    expect(sourceHashSchema.safeParse(value).success).toBe(true);
  });

  it.each([["A".repeat(64)], ["a".repeat(63)], ["a".repeat(65)], ["g".repeat(64)], [""]])("rejects %j", (value) => {
    expect(sourceHashSchema.safeParse(value).success).toBe(false);
  });
});

describe("translationInputSchema", () => {
  const input = { title: " Hello ", contentMd: "Body", sourceHash: hash };

  it("trims the title", () => {
    expect(translationInputSchema.parse(input)).toEqual({ ...input, title: "Hello" });
  });

  it.each([
    ["a blank title", { ...input, title: "  " }],
    ["a missing source hash", { title: "x", contentMd: "x" }],
    ["unknown fields such as origin", { ...input, origin: "machine" }],
    ["content over 200,000 characters", { ...input, contentMd: "x".repeat(200_001) }],
    ["an empty generated marker", { ...input, generated: {} }],
    ["a blank generated model", { ...input, generated: { model: "  " } }],
    ["a generated model over 100 characters", { ...input, generated: { model: "m".repeat(101) } }],
    ["unknown fields in generated", { ...input, generated: { model: "claude-sonnet-5-5", origin: "machine" } }],
    ["a non-object generated marker", { ...input, generated: "claude-sonnet-5-5" }],
  ])("rejects %s", (_name, value) => {
    expect(translationInputSchema.safeParse(value).success).toBe(false);
  });

  it("leaves generated out for human translations", () => {
    expect(translationInputSchema.parse(input)).not.toHaveProperty("generated");
  });

  it("accepts and trims the model of an unmodified machine translation", () => {
    expect(translationInputSchema.parse({ ...input, generated: { model: " claude-sonnet-5-5 " } }).generated).toEqual({
      model: "claude-sonnet-5-5",
    });
  });
});

describe("listPostsQuerySchema", () => {
  it("defaults to the default language", () => {
    expect(listPostsQuerySchema.parse({})).toEqual({ limit: 20, locale: "zh" });
    expect(listPostsQuerySchema.parse({ locale: "ja" }).locale).toBe("ja");
    expect(listPostsQuerySchema.safeParse({ locale: "fr" }).success).toBe(false);
  });
});

describe("postCreateInputSchema", () => {
  const input = { slug: "hello", title: "Hello", contentMd: "正文" };

  it("defaults status to draft and tags to []", () => {
    expect(postCreateInputSchema.parse(input)).toEqual({ ...input, status: "draft", tags: [] });
  });

  it("rejects unknown fields instead of silently dropping them", () => {
    expect(postCreateInputSchema.safeParse({ ...input, contentMD: "typo" }).success).toBe(false);
  });

  it("trims the title and rejects a blank one", () => {
    expect(postCreateInputSchema.parse({ ...input, title: "  Hi  " }).title).toBe("Hi");
    expect(postCreateInputSchema.safeParse({ ...input, title: "   " }).success).toBe(false);
  });
});

describe("postUpdateInputSchema", () => {
  it("does not fill in defaults, so a partial update leaves other fields alone", () => {
    expect(postUpdateInputSchema.parse({ title: "New" })).toEqual({ title: "New" });
  });

  it("rejects an empty update", () => {
    expect(postUpdateInputSchema.safeParse({}).success).toBe(false);
  });
});

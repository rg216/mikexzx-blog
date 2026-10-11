import { type AdminTranslationSummary, TRANSLATION_CONTENT_MAX_LENGTH, TRANSLATION_TITLE_MAX_LENGTH, translationInputSchema } from "@blog/shared";
import { describe, expect, it } from "vitest";
import {
  buildTranslationInput,
  canTranslateTo,
  checkUntranslated,
  decideGenerateStart,
  formFromSource,
  type GeneratedSnapshot,
  generatedMarker,
  generatedState,
  isTranslationDirty,
  issuesToTranslationErrors,
  localeShortLabel,
  modelDisplayName,
  needsSave,
  originLabel,
  translationSaveHint,
  translationState,
  translationLengthProblems,
  translationTargets,
  untranslatedFields,
  validateTranslationForm,
} from "./translation-form";

const hash = "0123456789abcdef".repeat(4);

function summary(overrides: Partial<AdminTranslationSummary> = {}): AdminTranslationSummary {
  return {
    locale: "en",
    title: "Hello",
    origin: "human",
    model: null,
    translatedAt: "2026-10-02T00:00:00.000Z",
    sourceHash: hash,
    outdated: false,
    ...overrides,
  };
}

describe("translationState", () => {
  it("distinguishes missing, synced and outdated", () => {
    expect(translationState(null)).toBe("missing");
    expect(translationState(summary())).toBe("synced");
    expect(translationState(summary({ outdated: true }))).toBe("outdated");
  });
});

describe("translationTargets", () => {
  it("lists every locale except the source language, in locales order, with existing summaries attached", () => {
    const ja = summary({ locale: "ja", title: "こんにちは", outdated: true });
    const targets = translationTargets({ sourceLocale: "zh", translations: [ja] });
    expect(targets.map((t) => t.locale)).toEqual(["en", "ja"]);
    expect(targets[0]).toMatchObject({ locale: "en", name: "英语", summary: null, state: "missing" });
    expect(targets[1]).toMatchObject({ locale: "ja", name: "日语", summary: ja, state: "outdated" });
  });

  it("follows the post's own source language instead of assuming Chinese", () => {
    const zh = summary({ locale: "zh" });
    const targets = translationTargets({ sourceLocale: "en", translations: [zh] });
    expect(targets.map((t) => t.locale)).toEqual(["zh", "ja"]);
    expect(targets[0]?.state).toBe("synced");
  });
});

describe("canTranslateTo", () => {
  it("rejects only the source language", () => {
    expect(canTranslateTo({ sourceLocale: "zh" }, "zh")).toBe(false);
    expect(canTranslateTo({ sourceLocale: "zh" }, "en")).toBe(true);
    expect(canTranslateTo({ sourceLocale: "ja" }, "zh")).toBe(true);
  });
});

describe("form values", () => {
  it("copies the source title and body verbatim as a starting point", () => {
    const content = "```ts\nconst a = 1;\n```\n\n![图](https://x/images/2026/10/abcdabcdabcdabcd.jpg#small)\n\n[链接](https://example.com)";
    expect(formFromSource({ title: "标题", contentMd: content })).toEqual({ title: "标题", contentMd: content });
  });

  it("detects changes in either field", () => {
    const base = { title: "A", contentMd: "B" };
    expect(isTranslationDirty(base, { ...base })).toBe(false);
    expect(isTranslationDirty(base, { ...base, title: "A2" })).toBe(true);
    expect(isTranslationDirty(base, { ...base, contentMd: "B2" })).toBe(true);
  });

  it("builds a PUT body that passes the shared schema and carries the given source hash", () => {
    const input = buildTranslationInput({ title: "Hello", contentMd: "Body" }, hash);
    expect(input).toEqual({ title: "Hello", contentMd: "Body", sourceHash: hash });
    expect(translationInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("needsSave", () => {
  const other = "f".repeat(64);
  it("always saves a new translation, even an unchanged copy", () => {
    expect(needsSave(null, false, hash)).toBe(true);
  });

  it("saves edits", () => {
    expect(needsSave({ sourceHash: hash }, true, hash)).toBe(true);
  });

  it("saves an unchanged translation to mark it synced with a newer source", () => {
    expect(needsSave({ sourceHash: other }, false, hash)).toBe(true);
  });

  it("skips only when nothing changed and it is already based on the current source", () => {
    expect(needsSave({ sourceHash: hash }, false, hash)).toBe(false);
  });
});

describe("validateTranslationForm", () => {
  it("accepts a title with an empty body (same rule as posts)", () => {
    expect(validateTranslationForm({ title: "Hello", contentMd: "" }, hash)).toEqual({});
  });

  it("reports a blank title on the title field in Chinese", () => {
    expect(validateTranslationForm({ title: "   ", contentMd: "x" }, hash)).toEqual({ title: "请填写标题" });
  });

  it("reports an over-long title", () => {
    expect(validateTranslationForm({ title: "a".repeat(201), contentMd: "" }, hash).title).toBe("标题不能超过 200 个字符");
  });

  it("puts a broken source hash on the form, not on a field", () => {
    const errors = validateTranslationForm({ title: "Hello", contentMd: "" }, "nope");
    expect(errors).toEqual({ form: "无效的原文指纹" });
  });
});

describe("issuesToTranslationErrors", () => {
  it("maps known fields, keeps the first message per field and sends the rest to form", () => {
    expect(
      issuesToTranslationErrors([
        { path: "title", message: "第一条" },
        { path: "title", message: "第二条" },
        { path: "contentMd", message: "太长" },
        { path: "sourceHash", message: "无效的原文指纹" },
        { path: "", message: "不能为原文语言添加译文" },
      ]),
    ).toEqual({ title: "第一条", contentMd: "太长", form: "无效的原文指纹" });
  });
});

describe("labels", () => {
  it("labels origins, with the model when known", () => {
    expect(originLabel("human", null)).toBe("人工翻译");
    expect(originLabel("machine", "claude-x")).toBe("机器翻译 · claude-x");
    expect(originLabel("machine", "claude-sonnet-5-5")).toBe("机器翻译 · Sonnet 5.5");
    expect(originLabel("machine", null)).toBe("机器翻译");
  });

  it("uses upper-case language codes as short labels", () => {
    expect(localeShortLabel("en")).toBe("EN");
    expect(localeShortLabel("ja")).toBe("JA");
  });

  it("warns that saving takes effect immediately only for published posts", () => {
    expect(translationSaveHint("published")).toContain("立即可见");
    expect(translationSaveHint("draft")).not.toContain("立即可见");
  });
});

describe("untranslated content", () => {
  const source = { title: "缓存策略", contentMd: "## 小标题\n\n正文。" };

  it("finds fields still identical to the source, ignoring surrounding whitespace", () => {
    expect(untranslatedFields({ title: " 缓存策略 ", contentMd: "## 小标题\n\n正文。\n" }, source)).toEqual(["title", "contentMd"]);
    expect(untranslatedFields({ title: "Caching", contentMd: source.contentMd }, source)).toEqual(["contentMd"]);
    expect(untranslatedFields({ title: "缓存策略", contentMd: "## Heading\n\nBody." }, source)).toEqual(["title"]);
    expect(untranslatedFields({ title: "Caching", contentMd: "## Heading\n\nBody." }, source)).toEqual([]);
  });

  it("does not count an empty source body as untranslated", () => {
    expect(untranslatedFields({ title: "Caching", contentMd: "" }, { title: "缓存", contentMd: "" })).toEqual([]);
  });

  it("refuses to save a translation identical to the source", () => {
    expect(checkUntranslated({ ...source }, source, null)).toEqual({ kind: "refuse" });
    expect(checkUntranslated({ title: "缓存策略 ", contentMd: ` ${source.contentMd}` }, source, null)).toEqual({ kind: "refuse" });
    // 原文只有标题：标题也没翻译，同样是原样照搬
    expect(checkUntranslated({ title: "缓存", contentMd: "" }, { title: "缓存", contentMd: "" }, null)).toEqual({ kind: "refuse" });
  });

  it("asks for confirmation when only one field is still the source", () => {
    expect(checkUntranslated({ title: "Caching", contentMd: source.contentMd }, source, null)).toEqual({ kind: "confirm", fields: ["contentMd"] });
    expect(checkUntranslated({ title: "缓存策略", contentMd: "Body." }, source, null)).toEqual({ kind: "confirm", fields: ["title"] });
  });

  it("does not ask again about a field that was already saved identical to the source", () => {
    const saved = { title: "缓存策略", contentMd: "Body." };
    expect(checkUntranslated({ title: "缓存策略", contentMd: "Body, edited." }, source, saved)).toEqual({ kind: "ok" });
    // 新变成和原文一样的字段仍要确认
    expect(checkUntranslated({ title: "Caching", contentMd: source.contentMd }, source, { title: "Caching", contentMd: "Body." })).toEqual({
      kind: "confirm",
      fields: ["contentMd"],
    });
  });

  it("passes a real translation", () => {
    expect(checkUntranslated({ title: "Caching", contentMd: "Body." }, source, null)).toEqual({ kind: "ok" });
  });
});

describe("machine or human translation", () => {
  const snapshot: GeneratedSnapshot = { title: "Hello", contentMd: "Body\n", model: "claude-sonnet-5-5" };

  it("marks a save as machine output only when title and body are exactly the generated ones", () => {
    expect(generatedMarker({ title: "Hello", contentMd: "Body\n" }, snapshot)).toEqual({ model: "claude-sonnet-5-5" });
    expect(generatedState({ title: "Hello", contentMd: "Body\n" }, snapshot)).toBe("unmodified");
  });

  it("treats any change, even whitespace, in either field as a human translation", () => {
    for (const values of [
      { title: "Hello!", contentMd: "Body\n" },
      { title: "Hello", contentMd: "Body" },
      { title: "Hello ", contentMd: "Body\n" },
    ]) {
      expect(generatedMarker(values, snapshot)).toBeUndefined();
      expect(generatedState(values, snapshot)).toBe("modified");
    }
  });

  it("has no marker when nothing was generated", () => {
    expect(generatedMarker({ title: "Hello", contentMd: "Body\n" }, null)).toBeUndefined();
    expect(generatedState({ title: "Hello", contentMd: "Body\n" }, null)).toBe("none");
  });

  it("puts the marker into a PUT body the shared schema accepts, and leaves it out otherwise", () => {
    const withMarker = buildTranslationInput({ title: "Hello", contentMd: "Body" }, hash, { model: "claude-sonnet-5-5" });
    expect(withMarker).toEqual({ title: "Hello", contentMd: "Body", sourceHash: hash, generated: { model: "claude-sonnet-5-5" } });
    expect(translationInputSchema.parse(withMarker).generated).toEqual({ model: "claude-sonnet-5-5" });
    const without = buildTranslationInput({ title: "Hello", contentMd: "Body" }, hash, undefined);
    expect("generated" in without).toBe(false);
  });
});

describe("modelDisplayName", () => {
  it("turns model ids into family + version", () => {
    expect(modelDisplayName("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelDisplayName("claude-opus-4-1-20250805")).toBe("Opus 4.1");
    expect(modelDisplayName("claude-haiku-5")).toBe("Haiku 5");
  });

  it("returns unknown formats unchanged", () => {
    expect(modelDisplayName("claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet-20241022");
    expect(modelDisplayName("gpt-x")).toBe("gpt-x");
    expect(modelDisplayName("claude-sonnet-5-5-extra")).toBe("claude-sonnet-5-5-extra");
  });

  it("converts each model of a combined list", () => {
    expect(modelDisplayName("claude-sonnet-5-5, claude-opus-5")).toBe("Sonnet 5.5, Opus 5");
  });
});

describe("decideGenerateStart", () => {
  const empty = { title: "", contentMd: "" };
  const before = { title: "Old", contentMd: "Old body." };

  it("never starts while an image is uploading", () => {
    expect(decideGenerateStart({ uploading: true, values: empty })).toBe("blocked_uploading");
    expect(decideGenerateStart({ uploading: true, values: before, retryBase: before })).toBe("blocked_uploading");
  });

  it("asks before generating over existing content, not over an empty editor", () => {
    expect(decideGenerateStart({ uploading: false, values: empty })).toBe("start");
    expect(decideGenerateStart({ uploading: false, values: { title: " ", contentMd: "\n" } })).toBe("start");
    expect(decideGenerateStart({ uploading: false, values: before })).toBe("confirm");
    expect(decideGenerateStart({ uploading: false, values: { title: "", contentMd: "x" } })).toBe("confirm");
  });

  it("retries without asking again only when nothing changed since the failed run started", () => {
    // 那次开始前已经确认过替换这份内容
    expect(decideGenerateStart({ uploading: false, values: before, retryBase: before })).toBe("start");
    // 失败之后作者又写了东西：续做完成时会被覆盖，要再确认
    expect(decideGenerateStart({ uploading: false, values: { ...before, contentMd: "Old body. My own paragraph." }, retryBase: before })).toBe("confirm");
    // 那次开始时编辑器是空的（没有确认过），之后写了东西
    expect(decideGenerateStart({ uploading: false, values: before, retryBase: empty })).toBe("confirm");
    // 失败后把内容清空了：没有可丢的
    expect(decideGenerateStart({ uploading: false, values: empty, retryBase: before })).toBe("start");
    expect(decideGenerateStart({ uploading: false, values: before, retryBase: null })).toBe("confirm");
  });
});

describe("translationLengthProblems", () => {
  it("accepts text right at the limits", () => {
    expect(translationLengthProblems({ title: `  ${"T".repeat(TRANSLATION_TITLE_MAX_LENGTH)}  `, contentMd: "x".repeat(TRANSLATION_CONTENT_MAX_LENGTH) })).toEqual([]);
  });

  it("names each field that is over its limit, with the numbers", () => {
    expect(translationLengthProblems({ title: "T".repeat(230), contentMd: "x".repeat(220_000) })).toEqual([
      "标题 230 字，超过 200 字的上限",
      "正文 220,000 字，超过 200,000 字的上限",
    ]);
    expect(translationLengthProblems({ title: "ok", contentMd: "x".repeat(TRANSLATION_CONTENT_MAX_LENGTH + 1) })).toHaveLength(1);
  });

  it("agrees with the save schema", () => {
    const sourceHash = "a".repeat(64);
    for (const values of [
      { title: "T".repeat(TRANSLATION_TITLE_MAX_LENGTH + 1), contentMd: "x" },
      { title: "T", contentMd: "x".repeat(TRANSLATION_CONTENT_MAX_LENGTH + 1) },
      { title: "T".repeat(TRANSLATION_TITLE_MAX_LENGTH), contentMd: "x".repeat(TRANSLATION_CONTENT_MAX_LENGTH) },
    ]) {
      const savable = translationInputSchema.safeParse({ ...values, sourceHash }).success;
      expect(translationLengthProblems(values).length === 0).toBe(savable);
    }
  });
});

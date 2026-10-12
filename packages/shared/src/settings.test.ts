import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSLATION_MODEL,
  defaultSiteSettings,
  settingsFromRows,
  siteSettingsUpdateSchema,
  translationModelIdSchema,
  translationModelInfo,
  translationModels,
} from "./settings.ts";
import { worstState } from "./status.ts";

describe("translationModels", () => {
  it("lists each model once, cheapest first, and only Haiku lacks a server-side fallback", () => {
    const ids = translationModels.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]);
    const prices = translationModels.map((model) => model.price.output);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(translationModels.filter((model) => !model.serverFallback).map((model) => model.id)).toEqual(["claude-haiku-5-5"]);
  });

  it("keeps the default on the list and looks models up by id", () => {
    expect(translationModelIdSchema.safeParse(DEFAULT_TRANSLATION_MODEL).success).toBe(true);
    expect(translationModelInfo("claude-opus-5-5").name).toBe("Opus 5.5");
    expect(translationModelIdSchema.safeParse("claude-sonnet-5").success).toBe(false);
  });
});

describe("settingsFromRows", () => {
  it("uses the defaults for missing keys", () => {
    expect(settingsFromRows([])).toEqual(defaultSiteSettings);
    expect(settingsFromRows([{ key: "tagTranslationModel", value: "claude-haiku-5-5" }])).toEqual({ ...defaultSiteSettings, tagTranslationModel: "claude-haiku-5-5" });
  });

  it("falls back per key for invalid values, and ignores unknown or inherited keys", () => {
    expect(
      settingsFromRows([
        { key: "translationModel", value: "claude-retired-1" },
        { key: "tagTranslationModel", value: "claude-fable-5-1" },
        { key: "oldSetting", value: true },
        { key: "toString", value: "claude-opus-5-5" },
      ]),
    ).toEqual({ translationModel: DEFAULT_TRANSLATION_MODEL, tagTranslationModel: "claude-fable-5-1" });
  });
});

describe("siteSettingsUpdateSchema", () => {
  it("accepts a partial update and rejects empty, unknown or invalid ones", () => {
    expect(siteSettingsUpdateSchema.parse({ translationModel: "claude-opus-5-5" })).toEqual({ translationModel: "claude-opus-5-5" });
    expect(siteSettingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(siteSettingsUpdateSchema.safeParse({ theme: "dark" }).success).toBe(false);
    expect(siteSettingsUpdateSchema.safeParse({ tagTranslationModel: "gpt-5" }).success).toBe(false);
  });
});

describe("worstState", () => {
  it("picks error over warning over ok over off", () => {
    expect(worstState(["ok", "off", "warning", "ok"])).toBe("warning");
    expect(worstState(["ok", "error", "warning"])).toBe("error");
    expect(worstState(["off", "ok"])).toBe("ok");
    expect(worstState(["off"])).toBe("off");
    expect(worstState([])).toBe("off");
  });
});

import type { PublicTranslationInfo } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { postNotice } from "./post-notice";

const translation = (origin: PublicTranslationInfo["origin"], outdated: boolean): PublicTranslationInfo => ({
  origin,
  outdated,
  translatedAt: "2026-10-01T00:00:00.000Z",
});

describe("postNotice", () => {
  it("says nothing on the original", () => {
    expect(postNotice({ locale: "zh", sourceLocale: "zh", translation: null }, "zh")).toBeNull();
  });

  it("explains a fallback to the original", () => {
    expect(postNotice({ locale: "zh", sourceLocale: "zh", translation: null }, "en")).toEqual({ messages: ["untranslated"], originalLocale: "zh" });
  });

  it("says nothing on an up-to-date human translation", () => {
    expect(postNotice({ locale: "en", sourceLocale: "zh", translation: translation("human", false) }, "en")).toBeNull();
  });

  it.each([
    ["machine", false, ["machine"]],
    ["human", true, ["outdated"]],
    ["machine", true, ["machine", "outdated"]],
  ] as const)("flags a %s translation (outdated: %s)", (origin, outdated, messages) => {
    expect(postNotice({ locale: "ja", sourceLocale: "zh", translation: translation(origin, outdated) }, "ja")).toEqual({
      messages,
      originalLocale: "zh",
    });
  });
});

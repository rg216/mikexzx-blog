import { describe, expect, it } from "vitest";
import { coverBriefInputSchema, coverConfigSchema, coverImageInputSchema, coverImageStreamEventSchema } from "./cover.ts";

describe("cover schemas", () => {
  it("defaults tags and body for a brief, and requires a title", () => {
    expect(coverBriefInputSchema.parse({ title: " 标题 " })).toEqual({ title: "标题", tags: [], contentMd: "" });
    expect(coverBriefInputSchema.safeParse({ title: " " }).success).toBe(false);
    expect(coverBriefInputSchema.safeParse({ title: "t", extra: 1 }).success).toBe(false);
  });

  it("requires a non-empty prompt to generate", () => {
    expect(coverImageInputSchema.parse({ prompt: " a key " })).toEqual({ prompt: "a key" });
    expect(coverImageInputSchema.safeParse({ prompt: "" }).success).toBe(false);
  });

  it("accepts base64 images in the stream and rejects anything else", () => {
    const done = { type: "done", contentType: "image/webp", image: "AAAA+/==", model: "gpt-image-2.5-flare", quality: "medium", usage: { inputTokens: 1, outputTokens: 2 } };
    expect(coverImageStreamEventSchema.safeParse(done).success).toBe(true);
    expect(coverImageStreamEventSchema.safeParse({ ...done, image: "<script>" }).success).toBe(false);
    expect(coverImageStreamEventSchema.safeParse({ ...done, contentType: "image/svg+xml" }).success).toBe(false);
  });

  it("describes each step's availability separately", () => {
    const config = {
      brief: { available: true, model: "claude-sonnet-5-5" },
      image: { available: false, model: "gpt-image-2.5-flare", quality: "low", reason: "not_configured" },
    };
    expect(coverConfigSchema.parse(config)).toEqual(config);
  });
});

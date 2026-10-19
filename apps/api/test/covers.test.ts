import { coverConfigSchema, coverImageStreamEventSchema, DEFAULT_COVER_STYLE, DEFAULT_TRANSLATION_MODEL } from "@blog/shared";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverBriefJob, CoverBriefOutcome, CoverBriefWriter } from "../src/lib/cover-brief.ts";
import type { CoverImageEvent, CoverImager, CoverImageRequest } from "../src/lib/cover-imager.ts";
import { rules } from "../src/lib/rate-limit.ts";
import { setupTestApp } from "./helpers.ts";

/*
 * 生成头图的接口：两步都只回给编辑器、不入库；都用假实现（绝不连真 API）。
 */

const usage = { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
const ok = { stopReason: "end_turn", refusalCategory: null, model: DEFAULT_TRANSLATION_MODEL, usage, fallback: false };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const IMAGE = "UklGRgAAAABXRUJQ"; // 只是一段 base64，接口不解码

const briefCalls: { job: CoverBriefJob; model: string }[] = [];
let briefImpl: () => Promise<CoverBriefOutcome>;
const briefWriter: CoverBriefWriter = {
  async writeBrief(job, { model }) {
    briefCalls.push({ job, model });
    return briefImpl();
  },
};

const imageCalls: CoverImageRequest[] = [];
let imageImpl: () => AsyncIterable<CoverImageEvent>;
const done: CoverImageEvent = { type: "done", image: IMAGE, contentType: "image/webp", model: "gpt-image-2.5-flare", quality: "medium", usage: { inputTokens: 5, outputTokens: 1568 } };
const coverImager: CoverImager = {
  verifyModel: async () => {},
  generate(request) {
    imageCalls.push(request);
    return imageImpl();
  },
};

const HEARTBEAT_MS = 20;
const { request, requestRaw } = setupTestApp({ coverBriefWriter: briefWriter, coverImager, withRedis: true, coverHeartbeatMs: HEARTBEAT_MS });

async function generateEvents(body: unknown = { prompt: "A glowing cache." }) {
  const res = await requestRaw("POST", "/admin/covers/generate", { body });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  return (await res.text())
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => coverImageStreamEventSchema.parse(JSON.parse(line)));
}

beforeEach(() => {
  briefCalls.length = 0;
  imageCalls.length = 0;
  briefImpl = async () => ({ text: '{"prompt":"A giant glowing key over a dark city.","alt":"夜色城市上空发光的巨大钥匙"}', ...ok });
  imageImpl = async function* () {
    yield { type: "start" };
    yield { type: "partial", index: 0, image: IMAGE, contentType: "image/webp" };
    yield done;
  };
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("GET /admin/covers/config", () => {
  it("reports both steps available with the models chosen in settings", async () => {
    let res = await request("GET", "/admin/covers/config");
    expect(res.status).toBe(200);
    expect(coverConfigSchema.parse(res.body)).toEqual({
      brief: { available: true, model: DEFAULT_TRANSLATION_MODEL },
      image: { available: true, model: "gpt-image-2.5-flare", quality: "medium" },
    });

    await request("PATCH", "/admin/settings", { body: { coverPromptModel: "claude-haiku-5-5", coverImageModel: "gpt-image-2.5-sunburst", coverImageQuality: "high" } });
    res = await request("GET", "/admin/covers/config");
    expect(res.body).toEqual({
      brief: { available: true, model: "claude-haiku-5-5" },
      image: { available: true, model: "gpt-image-2.5-sunburst", quality: "high" },
    });
  });

  it("requires a session", async () => {
    const res = await request("GET", "/admin/covers/config", { auth: false });
    expect(res.status).toBe(401);
  });
});

describe("POST /admin/covers/brief", () => {
  it("passes the form contents, the style and the chosen model to Claude and returns the brief", async () => {
    await request("PATCH", "/admin/settings", { body: { coverStyle: "Flat pastel illustration.", coverPromptModel: "claude-opus-5-5" } });
    const res = await request("POST", "/admin/covers/brief", {
      body: { title: "缓存的三种失效", tags: ["性能", "Next.js"], contentMd: "正文。", direction: "用钥匙比喻" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prompt: "A giant glowing key over a dark city.", alt: "夜色城市上空发光的巨大钥匙", model: DEFAULT_TRANSLATION_MODEL, usage });
    expect(briefCalls).toEqual([
      {
        model: "claude-opus-5-5",
        job: { sourceLocale: "zh", title: "缓存的三种失效", tags: ["性能", "Next.js"], contentMd: "正文。", direction: "用钥匙比喻", style: "Flat pastel illustration." },
      },
    ]);
  });

  it("uses the default style when it was never changed, and works without tags, body or direction", async () => {
    const res = await request("POST", "/admin/covers/brief", { body: { title: "只有标题" } });
    expect(res.status).toBe(200);
    expect(briefCalls[0]?.job).toMatchObject({ tags: [], contentMd: "", direction: "", style: DEFAULT_COVER_STYLE });
  });

  it("rejects a missing title before calling the model", async () => {
    const res = await request("POST", "/admin/covers/brief", { body: { title: "  ", contentMd: "x" } });
    expect(res.status).toBe(400);
    expect(briefCalls).toHaveLength(0);
  });

  it("reports a refusal and unparsable output as 502 with an explanation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    briefImpl = async () => ({ text: "", ...ok, stopReason: "refusal", refusalCategory: "cyber" });
    let res = await request("POST", "/admin/covers/brief", { body: { title: "t" } });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: { message: "模型拒绝为这篇文章写画面描述（类别：cyber）" } });

    briefImpl = async () => ({ text: "not json", ...ok });
    res = await request("POST", "/admin/covers/brief", { body: { title: "t" } });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: { message: "模型返回的不是合法的 JSON" } });
  });

  it("names the service in upstream errors (not the translation service)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    briefImpl = () => Promise.reject(new Anthropic.AuthenticationError(401, { type: "authentication_error" }, "bad key", new Headers()));
    const res = await request("POST", "/admin/covers/brief", { body: { title: "t" } });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: { message: "写画面描述的 Claude 服务的凭证无效或没有权限（详见服务器日志）" } });
  });
});

describe("POST /admin/covers/generate", () => {
  it("streams the previews and the image, using the style, model and quality from settings", async () => {
    await request("PATCH", "/admin/settings", { body: { coverStyle: "Bold 3D.", coverImageQuality: "low" } });
    const events = await generateEvents({ prompt: "  A glowing cache.  " });
    expect(events).toEqual([
      { type: "partial", index: 0, contentType: "image/webp", image: IMAGE },
      { type: "done", image: IMAGE, contentType: "image/webp", model: "gpt-image-2.5-flare", quality: "medium", usage: { inputTokens: 5, outputTokens: 1568 } },
    ]);
    expect(imageCalls).toHaveLength(1);
    expect(imageCalls[0]).toMatchObject({ prompt: "A glowing cache.", style: "Bold 3D.", model: "gpt-image-2.5-flare", quality: "low" });
    // 滥用监测用的标识是哈希，不是用户 id 本身
    expect(imageCalls[0]?.safetyIdentifier).toMatch(/^[0-9a-f]{32}$/);
  });

  it("writes pings while the image is being drawn", async () => {
    imageImpl = async function* () {
      yield { type: "start" };
      await sleep(HEARTBEAT_MS * 5);
      yield done;
    };
    const events = await generateEvents();
    const pings = events.filter((event) => event.type === "ping");
    expect(pings.length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("answers a moderation rejection of the prompt with a plain 400, before the stream starts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    imageImpl = async function* () {
      yield* [];
      throw new OpenAI.BadRequestError(400, { code: "moderation_blocked", message: "blocked" }, "blocked", new Headers());
    };
    const res = await request("POST", "/admin/covers/generate", { body: { prompt: "x" } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "validation_error", message: "被 OpenAI 的内容审核拦下了，改一下画面描述再试" } });
  });

  it("turns a failure in the middle of the stream into an error event", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    imageImpl = async function* () {
      yield { type: "start" };
      yield { type: "partial", index: 0, image: IMAGE, contentType: "image/webp" };
      throw new OpenAI.APIError(undefined, { type: "server_error", message: "oops" }, "oops", undefined);
    };
    const events = await generateEvents();
    expect(events.at(-1)).toEqual({ type: "error", code: "internal_error", message: "OpenAI 图像服务暂时不可用，请稍后再试" });
  });

  it("reports a stream that ends without an image", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    imageImpl = async function* () {
      yield { type: "start" };
    };
    const events = await generateEvents();
    expect(events).toEqual([{ type: "error", code: "internal_error", message: "出图意外中断，请重试" }]);
  });

  it("rejects an empty prompt without calling OpenAI or counting against the quota", async () => {
    const res = await request("POST", "/admin/covers/generate", { body: { prompt: " " } });
    expect(res.status).toBe(400);
    expect(imageCalls).toHaveLength(0);
    expect(res.headers.get("ratelimit-policy") ?? "").not.toContain("cover-image");
  });

  it("limits images per hour", async () => {
    for (let i = 0; i < rules.coverImage.limit; i++) {
      const res = await requestRaw("POST", "/admin/covers/generate", { body: { prompt: "x" } });
      expect(res.status).toBe(200);
      await res.text();
    }
    const limited = await request("POST", "/admin/covers/generate", { body: { prompt: "x" } });
    expect(limited.status).toBe(429);
    expect(imageCalls).toHaveLength(rules.coverImage.limit);
  });
});

describe("without the keys or Redis", () => {
  // 第二个 app：同一个测试库，什么都没配置
  const bare = setupTestApp();

  it("reports both steps as not configured and refuses to generate", async () => {
    const config = await bare.request("GET", "/admin/covers/config");
    expect(config.body).toEqual({
      brief: { available: false, model: DEFAULT_TRANSLATION_MODEL, reason: "not_configured" },
      image: { available: false, model: "gpt-image-2.5-flare", quality: "medium", reason: "not_configured" },
    });
    expect((await bare.request("POST", "/admin/covers/brief", { body: { title: "t" } })).status).toBe(503);
    expect((await bare.request("POST", "/admin/covers/generate", { body: { prompt: "x" } })).status).toBe(503);
  });
});

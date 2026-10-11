import { translationStreamEventSchema } from "@blog/shared";
import { describe, expect, it, vi } from "vitest";
import { type SegmentEvent, TRANSLATION_MODEL, type Translator } from "../src/lib/translator.ts";
import { setupTestApp } from "./helpers.ts";

/*
 * 翻译流的心跳：模型在第一段译文之前要先思考，可能几十秒没有输出。这期间 API 每隔一段时间写一行 {"type":"ping"}，
 * 让连接上一直有数据（中间的代理不把它当成空闲连接）。这里把间隔调成 20ms，让假翻译器"思考"一会儿。
 */

const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
const ok = { stopReason: "end_turn", refusalCategory: null, model: TRANSLATION_MODEL, usage, fallback: false };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let segmentImpl: () => AsyncIterable<SegmentEvent>;
const translator: Translator = {
  model: TRANSLATION_MODEL,
  async translateTitle() {
    return { text: "Title", ...ok };
  },
  streamSegment: () => segmentImpl(),
  translateTagName: () => Promise.reject(new Error("not used in this test")),
};

const HEARTBEAT_MS = 20;
const { request, requestRaw, createPost } = setupTestApp({ translator, withRedis: true, translationHeartbeatMs: HEARTBEAT_MS });

async function generateEvents() {
  const { id } = await createPost({ slug: "a", contentMd: "一段。" });
  const { sourceHash } = (await request("GET", `/admin/posts/${id}`)).body as { sourceHash: string };
  const res = await requestRaw("POST", `/admin/posts/${id}/translations/ja/generate`, { body: { part: "body", index: 0, sourceHash } });
  expect(res.status).toBe(200);
  return (await res.text())
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => translationStreamEventSchema.parse(JSON.parse(line)));
}

describe("heartbeat in the NDJSON stream", () => {
  it("writes pings while the model is thinking, then the content as usual", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    segmentImpl = async function* () {
      yield { type: "start" };
      // 思考：大约 6 个心跳间隔没有任何输出
      await sleep(HEARTBEAT_MS * 6);
      yield { type: "delta", text: "One." };
      yield { type: "done", text: "One.", ...ok };
    };
    const events = await generateEvents();
    const pings = events.filter((event) => event.type === "ping");
    // 计时器不精确：只要求有几次心跳，且都在内容之前
    expect(pings.length).toBeGreaterThanOrEqual(2);
    expect(pings.length).toBeLessThanOrEqual(7);
    expect(events.slice(pings.length)).toEqual([
      { type: "delta", text: "One." },
      { type: "done", text: "One.", stopReason: "end_turn", model: TRANSLATION_MODEL, usage },
    ]);
    vi.restoreAllMocks();
  });

  it("restarts the interval after every event: no pings while output keeps flowing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    segmentImpl = async function* () {
      yield { type: "start" };
      for (let i = 0; i < 6; i++) {
        await sleep(HEARTBEAT_MS / 4);
        yield { type: "delta", text: `${i}` };
      }
      yield { type: "done", text: "012345", ...ok };
    };
    const events = await generateEvents();
    expect(events.map((event) => event.type)).toEqual(["delta", "delta", "delta", "delta", "delta", "delta", "done"]);
    vi.restoreAllMocks();
  });

  it("still reports an upstream failure that happens while it is waiting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    segmentImpl = async function* () {
      yield { type: "start" };
      await sleep(HEARTBEAT_MS * 3);
      throw new Error("boom");
    };
    const events = await generateEvents();
    expect(events.at(-1)).toEqual({ type: "error", code: "internal_error", message: "服务器内部错误" });
    expect(events.slice(0, -1).every((event) => event.type === "ping")).toBe(true);
    vi.restoreAllMocks();
  });
});

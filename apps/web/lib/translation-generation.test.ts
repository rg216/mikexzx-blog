import { splitMarkdownForTranslation, type TranslationUsage, translationInputSchema, translationUnavailableReasons } from "@blog/shared";
import { describe, expect, it, vi } from "vitest";
import { AdminApiError, type StreamSegmentOptions, type TranslationSegmentResult } from "./admin-api";
import {
  addUsage,
  combineModels,
  describeGenerationFailure,
  formatUsage,
  type GenerationApi,
  GenerationError,
  type GenerationProgress,
  isWithinStopGrace,
  type GenerationSource,
  joinTranslatedSegments,
  runTranslationGeneration,
  SegmentRejectedError,
  STOP_GRACE_MS,
  stepLabel,
  stopReasonFailure,
  zeroUsage,
  unavailableReasonNotes,
} from "./translation-generation";

const hash = "c".repeat(64);
const usage = (n: number): TranslationUsage => ({ inputTokens: n, outputTokens: n * 2, cacheReadInputTokens: n * 3, cacheCreationInputTokens: n * 4 });

// 每段的首尾空行怎么对齐由 @blog/shared 的 fitTranslatedSegment 负责（和 API 共用，测试在 shared）
describe("joinTranslatedSegments", () => {
  it("replaces the model's surrounding blank lines with the source segment's trailing whitespace", () => {
    expect(joinTranslatedSegments(["第一段\n\n", "最后一段"], ["\n\nFirst\n", "Last\n\n"])).toBe("First\n\nLast");
  });

  it("keeps full-width spaces, which are content, at segment boundaries", () => {
    expect(joinTranslatedSegments(["段落　\n\n", "文\n"], ["Paragraph", "テキスト　"])).toBe("Paragraph\n\nテキスト　\n");
  });

  it("does not glue a paragraph to the next block when the model drops the blank line", () => {
    // 段落后面紧跟缩进代码：没有空行的话，代码会变成段落的续行
    const source = "段落\n\n    code\n";
    const segments = splitMarkdownForTranslation(source, 3);
    expect(segments).toEqual(["段落\n\n", "    code\n"]);
    expect(joinTranslatedSegments(segments, ["Paragraph", "    code"])).toBe("Paragraph\n\n    code\n");
  });

  it("joins only the segments translated so far", () => {
    expect(joinTranslatedSegments(["a\n\n", "b\n\n", "c"], ["A"])).toBe("A\n\n");
    expect(joinTranslatedSegments(["a\n\n", "b"], [])).toBe("");
  });
});

describe("small helpers", () => {
  it("adds usage field by field", () => {
    expect(addUsage(usage(1), usage(10))).toEqual(usage(11));
    expect(addUsage(zeroUsage, usage(2))).toEqual(usage(2));
  });

  it("lists distinct models in order of first appearance", () => {
    expect(combineModels(["m1", "m1", "m1"])).toBe("m1");
    expect(combineModels(["m1", "m2", "m1", "m3"])).toBe("m1, m2, m3");
  });

  it("keeps the combined models within what the save endpoint accepts", () => {
    const combined = combineModels(Array.from({ length: 20 }, (_, i) => `claude-fallback-model-${i}`));
    expect(combined.endsWith(", …")).toBe(true);
    expect(translationInputSchema.safeParse({ title: "t", contentMd: "c", sourceHash: hash, generated: { model: combined } }).success).toBe(true);
  });

  it("explains every reason the server may give for translation being unavailable", () => {
    for (const reason of translationUnavailableReasons) expect(unavailableReasonNotes[reason]).not.toBe("");
    expect(unavailableReasonNotes.not_configured).toContain("ANTHROPIC_API_KEY");
    expect(unavailableReasonNotes.rate_limiter_unavailable).toContain("Redis");
  });

  it("accepts only end_turn as success", () => {
    expect(stopReasonFailure("end_turn")).toBeNull();
    expect(stopReasonFailure("refusal")).toContain("拒绝");
    expect(stopReasonFailure("max_tokens")).toContain("截断");
    expect(stopReasonFailure("pause_turn")).toContain("pause_turn");
  });

  it("formats usage with thousands separators", () => {
    expect(formatUsage({ inputTokens: 1234, outputTokens: 5, cacheReadInputTokens: 10000, cacheCreationInputTokens: 0 })).toBe(
      "输入 1,234 · 输出 5 · 缓存命中 10,000 · 缓存写入 0",
    );
  });

  it("labels steps 1-based", () => {
    expect(stepLabel({ part: "title" })).toBe("标题");
    expect(stepLabel({ part: "body", index: 2, total: 7 })).toBe("第 3/7 段");
  });
});

describe("describeGenerationFailure", () => {
  const api = (code: ConstructorParameters<typeof AdminApiError>[1], message = "m") => new AdminApiError(400, code, message);

  it("asks to reload the source on conflict instead of retrying", () => {
    expect(describeGenerationFailure(api("conflict"), "第 1/2 段")).toMatchObject({ title: "原文已更新", action: "reload" });
  });

  it("offers no retry when logged out or the post is gone", () => {
    expect(describeGenerationFailure(api("unauthorized"), "标题").action).toBe("none");
    expect(describeGenerationFailure(api("not_found"), "标题").action).toBe("none");
  });

  it("offers retry for rejected segments, rate limits, upstream and unexpected errors", () => {
    expect(describeGenerationFailure(new SegmentRejectedError("模型拒绝翻译这部分内容"), "第 2/3 段")).toMatchObject({
      title: "生成失败（第 2/3 段）",
      action: "retry",
    });
    expect(describeGenerationFailure(api("rate_limited", "操作太频繁"), "第 2/3 段")).toMatchObject({ title: "生成失败（第 2/3 段）", action: "retry" });
    expect(describeGenerationFailure(api("internal_error", "上游出错"), "标题")).toMatchObject({ message: "上游出错", action: "retry" });
    expect(describeGenerationFailure(new Error("boom"), "标题")).toMatchObject({ message: "出现了意外错误，请稍后重试", action: "retry" });
  });

  it("tells the author that finished parts are kept when the upstream is rate limited", () => {
    const { message } = describeGenerationFailure(api("rate_limited", "翻译服务繁忙"), "第 2/3 段");
    expect(message).toContain("翻译服务繁忙");
    expect(message).toContain("已完成的部分会保留");
  });

  it("does not promise a partial manual path for a rejected segment (finished segments are not in the editor)", () => {
    const { message } = describeGenerationFailure(new SegmentRejectedError("模型拒绝翻译这部分内容"), "第 5/7 段");
    expect(message).toBe("模型拒绝翻译这部分内容。可以重试；仍然失败的话需要手动翻译。");
    expect(message).not.toContain("这部分。");
  });
});

describe("isWithinStopGrace", () => {
  it("ignores a stop that lands right after the start (a double click on the toggling button)", () => {
    expect(isWithinStopGrace(1000, 1000)).toBe(true);
    expect(isWithinStopGrace(1000, 1000 + STOP_GRACE_MS - 1)).toBe(true);
    expect(isWithinStopGrace(1000, 1000 + STOP_GRACE_MS)).toBe(false);
    expect(STOP_GRACE_MS).toBeGreaterThanOrEqual(300);
    expect(STOP_GRACE_MS).toBeLessThanOrEqual(1000);
  });
});

// ---------- runTranslationGeneration ----------

// 两个长段落夹一个代码块：按默认的 6000 字切成 3 段（段落 / 代码块 / 段落）
const filler = "字".repeat(5990);
const source: GenerationSource = {
  postId: 7,
  locale: "en",
  title: "标题",
  contentMd: `第一段${filler}\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\n第三段${filler}\n`,
  sourceHash: hash,
};

type SegmentReply = Partial<TranslationSegmentResult> & { deltas?: string[]; throws?: unknown; pings?: { before?: number; after?: number } };

/** 假的 api：段落译成 First. / Third.，代码块原样返回；可以按段号指定失败方式 */
function fakeApi(replies: Record<number, SegmentReply> = {}) {
  const calls: string[] = [];
  const segments = splitMarkdownForTranslation(source.contentMd);
  const english = (original: string) => (original.startsWith("第一段") ? "First." : original.startsWith("第三段") ? "Third." : original);
  const api: GenerationApi = {
    generateTranslationTitle: vi.fn<GenerationApi["generateTranslationTitle"]>(async (postId, locale, sourceHash) => {
      calls.push(`title ${postId} ${locale} ${sourceHash === hash}`);
      return { title: "  Title\n", model: "claude-sonnet-5-5", usage: usage(1) };
    }),
    streamTranslationSegment: vi.fn<GenerationApi["streamTranslationSegment"]>(async (_postId, _locale, { index, onDelta, onPing, signal }: StreamSegmentOptions) => {
      calls.push(`body ${index}`);
      const reply = replies[index] ?? {};
      if (reply.throws) throw reply.throws;
      const original = (segments[index] ?? "").trim();
      const text = reply.text ?? english(original);
      for (let i = 0; i < (reply.pings?.before ?? 0); i++) onPing?.();
      for (const [i, delta] of (reply.deltas ?? [text.slice(0, 3), text.slice(3)]).entries()) {
        signal?.throwIfAborted();
        onDelta?.(delta);
        if (i === 0) for (let j = 0; j < (reply.pings?.after ?? 0); j++) onPing?.();
      }
      return { type: "done", text, stopReason: reply.stopReason ?? "end_turn", model: reply.model ?? "claude-sonnet-5-5", usage: reply.usage ?? usage(10) };
    }),
  };
  return { api, calls, segments };
}

async function failure(promise: Promise<unknown>): Promise<GenerationError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof GenerationError)) throw new Error(`expected GenerationError, got ${String(error)}`);
  return error;
}

describe("runTranslationGeneration", () => {
  it("translates the title first, then each segment in order, and joins them like the source", async () => {
    const { api, calls, segments } = fakeApi();
    expect(segments).toHaveLength(3);
    const result = await runTranslationGeneration(api, source, { signal: new AbortController().signal });
    expect(calls).toEqual(["title 7 en true", "body 0", "body 1", "body 2"]);
    expect(result.title).toBe("Title");
    expect(result.contentMd).toBe("First.\n\n```js\nconst a = 1;\n```\n\nThird.\n");
    expect(result.model).toBe("claude-sonnet-5-5");
    expect(result.usage).toEqual(usage(31));
    expect(result.check).toEqual({ errors: [], warnings: [] });
  });

  it("reports progress: title, then each segment with live text and completed text", async () => {
    const { api } = fakeApi();
    const progress: GenerationProgress[] = [];
    await runTranslationGeneration(api, source, { signal: new AbortController().signal, onProgress: (p) => progress.push(p) });
    expect(progress[0]).toEqual({ part: "title", title: null, liveText: "", completedText: "" });
    expect(progress[1]).toEqual({ part: "body", index: 0, total: 3, title: "Title", liveText: "", completedText: "" });
    expect(progress[2]).toEqual({ part: "body", index: 0, total: 3, title: "Title", liveText: "Fir", completedText: "" });
    expect(progress[3]).toEqual({ part: "body", index: 0, total: 3, title: "Title", liveText: "First.", completedText: "" });
    expect(progress[4]).toEqual({ part: "body", index: 1, total: 3, title: "Title", liveText: "First.\n\n", completedText: "First.\n\n" });
    expect(progress.at(-1)).toMatchObject({ index: 2, liveText: expect.stringMatching(/Third\.$/) });
  });

  it("marks the progress as thinking when heartbeats arrive before any text of the segment, and not after", async () => {
    const { api } = fakeApi({ 1: { pings: { before: 2, after: 3 } } });
    const progress: GenerationProgress[] = [];
    const result = await runTranslationGeneration(api, source, { signal: new AbortController().signal, onProgress: (p) => progress.push(p) });
    const second = progress.filter((p) => p.part === "body" && p.index === 1);
    // 开始 → 两次心跳（思考中）→ 第一段文字 → 其后的心跳不再报告 → 第二段文字
    expect(second.map((p) => p.thinking ?? false)).toEqual([false, true, true, false, false]);
    expect(second[1]).toEqual({ part: "body", index: 1, total: 3, title: "Title", liveText: "First.\n\n", completedText: "First.\n\n", thinking: true });
    // 心跳不带内容：结果和没有心跳时一样
    expect(result.contentMd).toBe((await runTranslationGeneration(fakeApi().api, source, { signal: new AbortController().signal })).contentMd);
  });

  it("strips leading blank lines of the live text of a segment", async () => {
    const { api } = fakeApi({ 0: { deltas: ["\n", "\nFirst."], text: "\n\nFirst." } });
    const progress: GenerationProgress[] = [];
    const result = await runTranslationGeneration(api, source, { signal: new AbortController().signal, onProgress: (p) => progress.push(p) });
    expect(progress.filter((p) => p.part === "body" && p.index === 0).map((p) => p.liveText)).toEqual(["", "", "First."]);
    expect(result.contentMd.startsWith("First.\n\n")).toBe(true);
  });

  it("returns only a title for an empty body", async () => {
    const { api, calls } = fakeApi();
    const result = await runTranslationGeneration(api, { ...source, contentMd: "  \n" }, { signal: new AbortController().signal });
    expect(calls).toEqual(["title 7 en true"]);
    expect(result).toMatchObject({ title: "Title", contentMd: "" });
  });

  it("runs the structure check on the joined translation", async () => {
    const { api } = fakeApi({ 1: { text: "```js\nconst a = 2;\n```" } });
    const result = await runTranslationGeneration(api, source, { signal: new AbortController().signal });
    expect(result.check.errors.map((e) => e.kind)).toEqual(["code_block_changed"]);
  });

  it("records every model actually served and sums usage", async () => {
    const { api } = fakeApi({ 2: { model: "claude-fallback-1", usage: usage(100) } });
    const result = await runTranslationGeneration(api, source, { signal: new AbortController().signal });
    expect(result.model).toBe("claude-sonnet-5-5, claude-fallback-1");
    expect(result.usage).toEqual(usage(121));
  });

  it.each([
    ["refusal", "拒绝"],
    ["max_tokens", "截断"],
    ["stop_sequence", "stop_sequence"],
  ])("fails on stopReason %s and stops requesting further segments", async (stopReason, text) => {
    const { api, calls } = fakeApi({ 1: { stopReason } });
    const error = await failure(runTranslationGeneration(api, source, { signal: new AbortController().signal }));
    expect(error.reason).toBe("failed");
    expect(error.step).toEqual({ part: "body", index: 1, total: 3 });
    expect(error.cause).toBeInstanceOf(SegmentRejectedError);
    expect((error.cause as Error).message).toContain(text);
    expect(calls).toEqual(["title 7 en true", "body 0", "body 1"]);
    expect(error.partial.segments.map((s) => s.text)).toEqual(["First."]);
  });

  it("fails on an empty translation of a non-empty segment", async () => {
    const { api } = fakeApi({ 0: { text: " \n", deltas: [] } });
    const error = await failure(runTranslationGeneration(api, source, { signal: new AbortController().signal }));
    expect((error.cause as Error).message).toContain("空译文");
  });

  it("fails on an empty title", async () => {
    const { api } = fakeApi();
    vi.mocked(api.generateTranslationTitle).mockResolvedValueOnce({ title: "\n", model: "m", usage: usage(1) });
    const error = await failure(runTranslationGeneration(api, source, { signal: new AbortController().signal }));
    expect(error.step).toEqual({ part: "title" });
    expect(error.partial.title).toBeNull();
  });

  it("wraps API errors with the step they happened in", async () => {
    const apiError = new AdminApiError(409, "conflict", "原文已更新");
    const { api } = fakeApi({ 2: { throws: apiError } });
    const error = await failure(runTranslationGeneration(api, source, { signal: new AbortController().signal }));
    expect(error).toMatchObject({ reason: "failed", step: { part: "body", index: 2, total: 3 } });
    expect(error.cause).toBe(apiError);
    expect(error.partial.segments).toHaveLength(2);
  });

  it("resumes from the failed step without paying again for finished parts", async () => {
    const first = fakeApi({ 2: { throws: new AdminApiError(500, "internal_error", "x") } });
    const error = await failure(runTranslationGeneration(first.api, source, { signal: new AbortController().signal }));
    const second = fakeApi();
    const result = await runTranslationGeneration(second.api, source, { signal: new AbortController().signal, resume: error.partial });
    expect(second.calls).toEqual(["body 2"]);
    expect(result.contentMd).toBe("First.\n\n```js\nconst a = 1;\n```\n\nThird.\n");
    expect(result.usage).toEqual(usage(31));
  });

  it("ignores a partial result made for another version of the source", async () => {
    const first = fakeApi({ 1: { throws: new AdminApiError(500, "internal_error", "x") } });
    const error = await failure(runTranslationGeneration(first.api, source, { signal: new AbortController().signal }));
    const second = fakeApi();
    await runTranslationGeneration(second.api, { ...source, sourceHash: "d".repeat(64) }, { signal: new AbortController().signal, resume: error.partial });
    expect(second.calls[0]).toMatch(/^title/);
    expect(second.calls).toHaveLength(4);
  });

  it("does not mutate the partial it resumed from", async () => {
    const first = fakeApi({ 1: { throws: new AdminApiError(500, "internal_error", "x") } });
    const error = await failure(runTranslationGeneration(first.api, source, { signal: new AbortController().signal }));
    await runTranslationGeneration(fakeApi().api, source, { signal: new AbortController().signal, resume: error.partial });
    expect(error.partial.segments).toHaveLength(1);
  });

  it("reports an abort during a segment as aborted, not failed", async () => {
    const controller = new AbortController();
    const { api, calls } = fakeApi();
    const error = await failure(
      runTranslationGeneration(api, source, {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.part === "body" && p.index === 1 && p.liveText.endsWith("```")) controller.abort();
        },
      }),
    );
    expect(error.reason).toBe("aborted");
    expect(error.step).toMatchObject({ part: "body", index: 1 });
    expect(calls).toEqual(["title 7 en true", "body 0", "body 1"]);
  });

  it("reports an abort that lands just as a request resolves", async () => {
    const controller = new AbortController();
    const { api, calls } = fakeApi();
    vi.mocked(api.generateTranslationTitle).mockImplementationOnce(async () => {
      controller.abort();
      return { title: "T", model: "m", usage: usage(1) };
    });
    const error = await failure(runTranslationGeneration(api, source, { signal: controller.signal }));
    expect(error).toMatchObject({ reason: "aborted", step: { part: "title" } });
    expect(calls).toEqual([]);
  });

  it.each([
    ["the last segment", 2],
    ["a middle segment", 1],
  ])("reports an abort that lands just as %s resolves, without keeping that segment", async (_name, abortAt) => {
    const controller = new AbortController();
    const { api, calls } = fakeApi();
    const original = vi.mocked(api.streamTranslationSegment).getMockImplementation();
    vi.mocked(api.streamTranslationSegment).mockImplementation(async (postId, locale, options) => {
      if (options.index !== abortAt) return original?.(postId, locale, options) ?? Promise.reject(new Error("no impl"));
      calls.push(`body ${options.index}`);
      controller.abort();
      return { type: "done", text: "x", stopReason: "end_turn", model: "m", usage: usage(1) };
    });
    const error = await failure(runTranslationGeneration(api, source, { signal: controller.signal }));
    expect(error).toMatchObject({ reason: "aborted", step: { part: "body", index: abortAt, total: 3 } });
    expect(error.partial.segments).toHaveLength(abortAt);
    expect(calls.at(-1)).toBe(`body ${abortAt}`);
  });

  it("puts a title with line breaks on one line", async () => {
    const { api } = fakeApi();
    vi.mocked(api.generateTranslationTitle).mockResolvedValueOnce({ title: " A\nB\r\nC\rD ", model: "m", usage: usage(1) });
    const result = await runTranslationGeneration(api, source, { signal: new AbortController().signal });
    expect(result.title).toBe("A B C D");
  });

  it("treats an error raised after abort as an abort", async () => {
    const controller = new AbortController();
    const { api } = fakeApi();
    vi.mocked(api.streamTranslationSegment).mockImplementationOnce(async () => {
      controller.abort();
      throw new AdminApiError(0, "network_error", "x");
    });
    const error = await failure(runTranslationGeneration(api, source, { signal: controller.signal }));
    expect(error.reason).toBe("aborted");
  });

  it("does nothing when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { api, calls } = fakeApi();
    expect((await failure(runTranslationGeneration(api, source, { signal: controller.signal }))).reason).toBe("aborted");
    expect(calls).toEqual([]);
  });
});

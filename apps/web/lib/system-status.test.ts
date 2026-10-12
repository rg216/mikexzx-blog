import { translationModelInfo } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { compareVersions, formatLatency, jobStateLabel, modelPriceLabel, shortVersion } from "./system-status";

describe("compareVersions", () => {
  const a = "1c8e434b0e8f2a1d9f0c3b5e7a9d1f2e3c4b5a6d";
  const b = "df494a5c1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a";
  it("is ok when both are the same commit, and warns when they differ", () => {
    expect(compareVersions(a, a)).toEqual({ state: "ok", summary: "前端和 API 是同一次提交（1c8e434）" });
    expect(compareVersions(a, b)).toEqual({ state: "warning", summary: "前端是 1c8e434，API 是 df494a5：可能有一边还在部署，或部署失败了" });
  });
  it("does not compare when either side runs locally", () => {
    expect(compareVersions(null, a).state).toBe("off");
    expect(compareVersions(a, null).state).toBe("off");
  });
});

describe("small formatters", () => {
  it("shortens versions, formats latency and labels never-run jobs", () => {
    expect(shortVersion(null)).toBe("本地");
    expect(shortVersion("abcdef1234")).toBe("abcdef1");
    expect(formatLatency(null)).toBeNull();
    expect(formatLatency(42)).toBe("42 毫秒");
    expect(formatLatency(1540)).toBe("1.5 秒");
    expect(jobStateLabel("off")).toBe("从未运行");
    expect(jobStateLabel("error")).toBe("异常");
  });
});

describe("modelPriceLabel", () => {
  it("shows input / output per million tokens, plus Haiku's long-prompt tier", () => {
    expect(modelPriceLabel(translationModelInfo("claude-sonnet-5-5"))).toBe("每百万 token：输入 / 输出 $2 / $10");
    expect(modelPriceLabel(translationModelInfo("claude-haiku-5-5"))).toBe("每百万 token：输入 / 输出 $0.1 / $0.5；提示超过 10 万 token 时 $0.5 / $2.5");
  });
});

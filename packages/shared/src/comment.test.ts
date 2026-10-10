import { describe, expect, it } from "vitest";
import { canEditComment, commenterAddInputSchema } from "./comment.ts";

describe("canEditComment", () => {
  it("lets whitelisted authors edit anything of theirs", () => {
    expect(canEditComment("trusted", "approved")).toBe(true);
    expect(canEditComment("trusted", "pending")).toBe(true);
  });

  it("lets other authors edit only before approval", () => {
    expect(canEditComment("default", "pending")).toBe(true);
    expect(canEditComment("default", "approved")).toBe(false);
  });

  it("never lets blocked users edit", () => {
    expect(canEditComment("blocked", "pending")).toBe(false);
    expect(canEditComment("blocked", "approved")).toBe(false);
  });
});

describe("commenterAddInputSchema", () => {
  it.each(["octocat", "a", "my-name-1"])("accepts the GitHub username %s", (login) => {
    expect(commenterAddInputSchema.safeParse({ login }).success).toBe(true);
  });

  it.each(["-lead", "trail-", "dou--ble", "has space", "a".repeat(40)])("rejects %s", (login) => {
    expect(commenterAddInputSchema.safeParse({ login }).success).toBe(false);
  });
});

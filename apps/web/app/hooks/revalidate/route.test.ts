import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag }));

const { POST } = await import("./route");

const SECRET = "test-revalidate-secret-0123456789abcdef";
const call = (body: unknown, authorization?: string) =>
  POST(
    new Request("http://web.test/hooks/revalidate", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization && { authorization }) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => vi.stubEnv("REVALIDATE_SECRET", SECRET));
afterEach(() => {
  vi.unstubAllEnvs();
  revalidateTag.mockReset();
});

describe("POST /hooks/revalidate", () => {
  it("expires each tag immediately", async () => {
    const res = await call({ tags: ["posts", "post:a"] }, `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(revalidateTag.mock.calls).toEqual([
      ["posts", { expire: 0 }],
      ["post:a", { expire: 0 }],
    ]);
  });

  it.each([
    ["no credentials", undefined],
    ["a wrong secret", "Bearer nope"],
    ["the wrong scheme", `Basic ${SECRET}`],
  ])("rejects %s", async (_name, authorization) => {
    expect((await call({ tags: ["posts"] }, authorization)).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each([["{not json"], [{ tags: [] }], [{ tag: "posts" }]])("rejects a malformed body %j", async (body) => {
    expect((await call(body, `Bearer ${SECRET}`)).status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("refuses to work when no secret is configured", async () => {
    vi.stubEnv("REVALIDATE_SECRET", "");
    expect((await call({ tags: ["posts"] }, "Bearer ")).status).toBe(503);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createRevalidator, tagsForChange } from "./revalidate.ts";

describe("tagsForChange", () => {
  const draft = (slug: string) => ({ slug, status: "draft" as const });
  const live = (slug: string) => ({ slug, status: "published" as const });

  it.each([
    ["creating a draft", null, draft("a"), []],
    ["editing a draft", draft("a"), draft("a"), []],
    ["deleting a draft", draft("a"), null, []],
    ["creating a published post", null, live("a"), ["posts", "post:a"]],
    ["publishing a draft", draft("a"), live("a"), ["posts", "post:a"]],
    ["editing a published post", live("a"), live("a"), ["posts", "post:a"]],
    ["unpublishing", live("a"), draft("a"), ["posts", "post:a"]],
    ["renaming a published post", live("old"), live("new"), ["posts", "post:old", "post:new"]],
    ["deleting a published post", live("a"), null, ["posts", "post:a"]],
  ])("%s", (_name, before, after, expected) => {
    expect(tagsForChange(before, after)).toEqual(expected);
  });
});

describe("createRevalidator", () => {
  it("POSTs the tags with the shared secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await createRevalidator({ url: "https://web.test/hooks/revalidate", secret: "s3cret", fetchImpl })(["posts"]);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://web.test/hooks/revalidate");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer s3cret");
    expect(init?.body).toBe(JSON.stringify({ tags: ["posts"] }));
  });

  it("never throws when the web app is down or rejects the call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(createRevalidator({ url: "https://x", secret: "s", fetchImpl: down })(["posts"])).resolves.toBeUndefined();
    await expect(createRevalidator({ url: "https://x", secret: "s", fetchImpl: rejected })(["posts"])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("gives up after the timeout instead of holding the request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const started = Date.now();
    await createRevalidator({ url: "https://x", secret: "s", fetchImpl: hang, timeoutMs: 50 })(["posts"]);
    expect(Date.now() - started).toBeLessThan(1000);
    warn.mockRestore();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createRevalidator, tagsForChange, tagsForTranslationChange } from "./revalidate.ts";

describe("tagsForChange", () => {
  const draft = (slug: string) => ({ slug, status: "draft" as const });
  const live = (slug: string) => ({ slug, status: "published" as const });
  // 列表类标签：每种语言一个
  const lists = ["posts:zh", "posts:en", "posts:ja"];
  const pages = (slug: string) => [`post:${slug}:zh`, `post:${slug}:en`, `post:${slug}:ja`];

  it.each([
    ["creating a draft", null, draft("a"), []],
    ["editing a draft", draft("a"), draft("a"), []],
    ["deleting a draft", draft("a"), null, []],
    ["creating a published post", null, live("a"), [...lists, ...pages("a")]],
    ["publishing a draft", draft("a"), live("a"), [...lists, ...pages("a")]],
    ["editing a published post", live("a"), live("a"), [...lists, ...pages("a")]],
    ["unpublishing", live("a"), draft("a"), [...lists, ...pages("a")]],
    ["renaming a published post", live("old"), live("new"), [...lists, ...pages("old"), ...pages("new")]],
    ["deleting a published post", live("a"), null, [...lists, ...pages("a")]],
  ])("%s", (_name, before, after, expected) => {
    expect(tagsForChange(before, after)).toEqual(expected);
  });

  it("stays within the revalidate request limit", () => {
    expect(tagsForChange(live("old"), live("new")).length).toBeLessThanOrEqual(50);
  });
});

describe("tagsForTranslationChange", () => {
  const change = (overrides: Partial<Parameters<typeof tagsForTranslationChange>[0]>) =>
    tagsForTranslationChange({ slug: "a", status: "published", locale: "en", existedBefore: true, existsAfter: true, ...overrides });

  it("does nothing for drafts, whose translations readers cannot see", () => {
    expect(change({ status: "draft", existedBefore: false })).toEqual([]);
    expect(change({ status: "draft" })).toEqual([]);
  });

  it("only touches that language when an existing translation is edited", () => {
    expect(change({})).toEqual(["posts:en", "post:a:en"]);
  });

  it("also refreshes the other languages' pages when a translation appears or disappears", () => {
    expect(change({ existedBefore: false })).toEqual(["posts:en", "post:a:en", "post:a:zh", "post:a:ja"]);
    expect(change({ locale: "ja", existsAfter: false })).toEqual(["posts:ja", "post:a:ja", "post:a:zh", "post:a:en"]);
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

import { describe, expect, it } from "vitest";
import { safeReturnPath, withQuery } from "./safe-path.ts";

describe("safeReturnPath", () => {
  it.each(["/", "/posts/hello#comments", "/search?q=x"])("accepts the site path %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/a\r\nSet-Cookie: x=1", `/${"a".repeat(600)}`])(
    "falls back for %j",
    (value) => {
      expect(safeReturnPath(value, "/fallback")).toBe("/fallback");
    },
  );
});

describe("withQuery", () => {
  it("adds parameters before the hash", () => {
    expect(withQuery("/posts/a#comments", { login: "failed" })).toBe("/posts/a?login=failed#comments");
    expect(withQuery("/search?q=x", { login: "ok" })).toBe("/search?q=x&login=ok");
  });
});

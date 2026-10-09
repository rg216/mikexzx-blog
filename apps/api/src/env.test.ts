import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.ts";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", WEB_ORIGIN: "https://blog.example/" };

describe("loadEnv", () => {
  it("normalizes WEB_ORIGIN to an origin and defaults PORT", () => {
    expect(loadEnv(base)).toMatchObject({ WEB_ORIGIN: "https://blog.example", PORT: 8787 });
  });

  it("trims a trailing newline pasted from the terminal", () => {
    const token = "a".repeat(44);
    expect(loadEnv({ ...base, ADMIN_SETUP_TOKEN: `${token}\n` }).ADMIN_SETUP_TOKEN).toBe(token);
  });

  it("treats blank values as unset", () => {
    expect(loadEnv({ ...base, ADMIN_SETUP_TOKEN: "  \n" }).ADMIN_SETUP_TOKEN).toBeUndefined();
  });

  it("rejects a short setup token and names the variable", () => {
    expect(() => loadEnv({ ...base, ADMIN_SETUP_TOKEN: "short" })).toThrow(/ADMIN_SETUP_TOKEN/);
  });

  it("requires WEB_ORIGIN", () => {
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/WEB_ORIGIN/);
  });
});

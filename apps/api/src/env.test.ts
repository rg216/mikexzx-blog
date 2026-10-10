import { describe, expect, it } from "vitest";
import { githubConfigFrom, loadEnv, storageConfigFrom } from "./env.ts";

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

  describe("object storage", () => {
    const storage = {
      S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
      S3_BUCKET: "blog",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_PUBLIC_URL: "https://pub-x.r2.dev",
    };

    it("is optional as a whole", () => {
      expect(storageConfigFrom(loadEnv(base))).toBeNull();
    });

    it("builds the config with region auto by default", () => {
      expect(storageConfigFrom(loadEnv({ ...base, ...storage }))).toEqual({
        endpoint: storage.S3_ENDPOINT,
        region: "auto",
        bucket: "blog",
        credentials: { accessKeyId: "key", secretAccessKey: "secret" },
        publicUrl: storage.S3_PUBLIC_URL,
      });
    });

    it("rejects a partial config and names what is missing", () => {
      const { S3_PUBLIC_URL: _omitted, ...partial } = storage;
      expect(() => loadEnv({ ...base, ...partial })).toThrow(/S3_PUBLIC_URL/);
    });
  });

  describe("GitHub login", () => {
    it("derives the callback URL from WEB_ORIGIN", () => {
      expect(githubConfigFrom(loadEnv({ ...base, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" }))).toEqual({
        clientId: "id",
        clientSecret: "secret",
        redirectUri: "https://blog.example/api/auth/github/callback",
      });
      expect(githubConfigFrom(loadEnv(base))).toBeNull();
    });

    it("rejects a client id without its secret", () => {
      expect(() => loadEnv({ ...base, GITHUB_CLIENT_ID: "id" })).toThrow(/GITHUB_CLIENT_SECRET/);
    });
  });
});

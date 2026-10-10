import { describe, expect, it } from "vitest";
import { presignUrl, signRequest, uriEncode, uriEncodePath } from "./sigv4.ts";

// AWS 文档里的示例凭证和时间（公开的测试向量，不是真实密钥）
const credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
const now = new Date("2013-05-24T00:00:00Z");

describe("presignUrl", () => {
  it("matches the AWS documentation example for a presigned GET", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = new URL(
      presignUrl({ method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), region: "us-east-1", credentials, now, expiresIn: 86400 }),
    );
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });

  it("signs extra headers, so they become mandatory for the uploader", () => {
    const url = new URL(
      presignUrl({
        method: "PUT",
        url: new URL("http://localhost:8333/bucket/a.png"),
        region: "us-east-1",
        credentials,
        now,
        expiresIn: 300,
        headers: { "Content-Type": "image/png", "content-length": "123" },
      }),
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    // 头的值也参与签名：同样的请求换一个 content-length，签名就不同
    const other = new URL(
      presignUrl({
        method: "PUT",
        url: new URL("http://localhost:8333/bucket/a.png"),
        region: "us-east-1",
        credentials,
        now,
        expiresIn: 300,
        headers: { "Content-Type": "image/png", "content-length": "124" },
      }),
    );
    expect(other.searchParams.get("X-Amz-Signature")).not.toBe(url.searchParams.get("X-Amz-Signature"));
  });
});

describe("signRequest", () => {
  it("matches the AWS documentation example for a GET with the Authorization header", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html（Example: GET Object）
    const headers = signRequest({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      region: "us-east-1",
      credentials,
      now,
      headers: { range: "bytes=0-9" },
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(headers).not.toHaveProperty("host");
  });
});

describe("uriEncode", () => {
  it("encodes the characters encodeURIComponent leaves alone", () => {
    expect(uriEncode("a b!'()*~-_.")).toBe("a%20b%21%27%28%29%2A~-_.");
  });

  it("keeps slashes between path segments", () => {
    expect(uriEncodePath("images/2026/10/图 1.png")).toBe("images/2026/10/%E5%9B%BE%201.png");
  });
});

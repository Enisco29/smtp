import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signImportToken, verifyImportToken } from "@/lib/csv/import-token-core";

describe("CSV preview tokens", () => {
  const key = randomBytes(32);
  const claims = { version: 1 as const, userId: "user-1", campaignId: "campaign-1", digest: "abc", expiresAt: 10_000 };

  it("authenticates a preview for its short validity window", () => {
    expect(verifyImportToken(signImportToken(claims, key), key, 9_999)).toEqual(claims);
    expect(verifyImportToken(signImportToken(claims, key), key, 10_000)).toBeNull();
  });

  it("rejects altered or unsigned preview data", () => {
    const token = signImportToken(claims, key);
    const [payload, signature] = token.split(".");
    // Alter a full signature character, avoiding no-op and base64 padding changes.
    const altered = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(verifyImportToken(`${payload}.${altered}`, key, 9_000)).toBeNull();
    expect(verifyImportToken("fake.fake", key, 9_000)).toBeNull();
  });
});

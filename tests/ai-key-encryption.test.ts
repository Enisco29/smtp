import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decryptAiKey, encryptAiKey } from "@/lib/ai/keys";

afterEach(() => vi.unstubAllEnvs());

describe("per-user AI key encryption", () => {
  it("round-trips a key with fresh ciphertext each time", () => {
    vi.stubEnv("AI_KEY_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const first = encryptAiKey("sk-private-test");
    const second = encryptAiKey("sk-private-test");
    expect(first).not.toBe(second);
    expect(first).not.toContain("sk-private-test");
    expect(decryptAiKey(first)).toBe("sk-private-test");
    expect(decryptAiKey(second)).toBe("sk-private-test");
  });

  it("rejects a missing or malformed encryption key", () => {
    vi.stubEnv("AI_KEY_ENCRYPTION_KEY", "");
    expect(() => encryptAiKey("secret")).toThrow();
    vi.stubEnv("AI_KEY_ENCRYPTION_KEY", "not-a-32-byte-key");
    expect(() => encryptAiKey("secret")).toThrow();
  });
});

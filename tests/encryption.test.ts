import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptWithKey, encryptWithKey } from "@/lib/security/encryption-core";

describe("SMTP credential encryption", () => {
  it("round trips a credential without including plaintext", () => {
    const key = randomBytes(32);
    const encrypted = encryptWithKey("app password", key);
    expect(encrypted).not.toContain("app password");
    expect(decryptWithKey(encrypted, key)).toBe("app password");
  });

  it("uses a unique IV for every encryption", () => {
    const key = randomBytes(32);
    expect(encryptWithKey("same", key)).not.toBe(encryptWithKey("same", key));
  });

  it("rejects tampered ciphertext", () => {
    const key = randomBytes(32);
    const encrypted = encryptWithKey("secret", key);
    const parts = encrypted.split(":");
    parts[3] = `${parts[3]?.slice(0, -1)}A`;
    expect(() => decryptWithKey(parts.join(":"), key)).toThrow();
  });
});

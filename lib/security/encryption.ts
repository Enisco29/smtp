import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { decryptWithKey, encryptWithKey } from "@/lib/security/encryption-core";

function key() {
  const decoded = Buffer.from(getServerEnv().encryptionKey, "base64");
  if (decoded.length !== 32) throw new Error("SMTP_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return decoded;
}

export function encryptSecret(plaintext: string) {
  return encryptWithKey(plaintext, key());
}

export function decryptSecret(payload: string) {
  return decryptWithKey(payload, key());
}

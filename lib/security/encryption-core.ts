import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function validateKey(key: Buffer) {
  if (key.length !== 32) throw new Error("Encryption key must be exactly 32 bytes.");
}

export function encryptWithKey(plaintext: string, key: Buffer) {
  validateKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptWithKey(payload: string, key: Buffer) {
  validateKey(key);
  const [version, ivValue, tagValue, ciphertextValue, extra] = payload.split(":");
  if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue || extra) throw new Error("Invalid encrypted credential format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

import { createHmac, timingSafeEqual } from "node:crypto";

export type ImportTokenClaims = {
  version: 1;
  userId: string;
  campaignId: string;
  digest: string;
  expiresAt: number;
};

export function signImportToken(claims: ImportTokenClaims, key: Buffer) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyImportToken(token: string, key: Buffer, now = Date.now()): ImportTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", key).update(payload).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ImportTokenClaims>;
    if (claims.version !== 1 || typeof claims.userId !== "string" || typeof claims.campaignId !== "string" || typeof claims.digest !== "string" || typeof claims.expiresAt !== "number" || claims.expiresAt <= now) return null;
    return claims as ImportTokenClaims;
  } catch {
    return null;
  }
}

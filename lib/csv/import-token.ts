import "server-only";
import { hkdfSync } from "node:crypto";
import { getServerEnv } from "@/lib/env/server";
import { signImportToken, verifyImportToken } from "@/lib/csv/import-token-core";

function tokenKey() {
  const source = Buffer.from(getServerEnv().encryptionKey, "base64");
  if (source.length !== 32) throw new Error("SMTP_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return Buffer.from(hkdfSync("sha256", source, Buffer.alloc(0), "relaycraft-csv-import-v1", 32));
}

export function createImportPreviewToken(userId: string, campaignId: string, digest: string) {
  return signImportToken({ version: 1, userId, campaignId, digest, expiresAt: Date.now() + 10 * 60_000 }, tokenKey());
}

export function validateImportPreviewToken(token: string, userId: string, campaignId: string, digest: string) {
  const claims = verifyImportToken(token, tokenKey());
  return Boolean(claims && claims.userId === userId && claims.campaignId === campaignId && claims.digest === digest);
}

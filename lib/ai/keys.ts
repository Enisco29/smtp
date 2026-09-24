import "server-only";
import { getAiEncryptionKey } from "@/lib/env/server";
import { decryptWithKey, encryptWithKey } from "@/lib/security/encryption-core";

export function encryptAiKey(key: string) { return encryptWithKey(key, getAiEncryptionKey()); }
export function decryptAiKey(encrypted: string) { return decryptWithKey(encrypted, getAiEncryptionKey()); }

import "server-only";
import { z } from "zod";

const schema = z.object({
  serviceRoleKey: z.string().min(1),
  encryptionKey: z.string().min(1),
});

export function getServerEnv() {
  const result = schema.safeParse({
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    encryptionKey: process.env.SMTP_ENCRYPTION_KEY,
  });
  if (!result.success) throw new Error("Missing required server environment variables.");
  return result.data;
}

export function getAiEncryptionKey() {
  const value = process.env.AI_KEY_ENCRYPTION_KEY;
  if (!value) throw new Error("AI_KEY_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("AI_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

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

import { z } from "zod";

const schema = z.object({
  url: z.string().url(),
  publishableKey: z.string().min(1),
});

export function getSupabasePublicEnv() {
  const result = schema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!result.success) throw new Error("Missing or invalid public Supabase environment variables.");
  return result.data;
}

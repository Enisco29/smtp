import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";

export function createAdminClient() {
  const publicEnv = getSupabasePublicEnv();
  const serverEnv = getServerEnv();
  return createClient(publicEnv.url, serverEnv.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

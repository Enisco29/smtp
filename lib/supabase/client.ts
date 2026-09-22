"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/env/public";

export function createClient() {
  const env = getSupabasePublicEnv();
  return createBrowserClient(env.url, env.publishableKey);
}

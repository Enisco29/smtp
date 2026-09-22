import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function getSessionDestination() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "/login";
  const { data } = await supabase.from("profiles").select("onboarding_completed_at").eq("id", user.id).maybeSingle();
  return data?.onboarding_completed_at ? "/dashboard" : "/onboarding";
}

export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireOnboardedUser(): Promise<User> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("onboarding_completed_at").eq("id", user.id).maybeSingle();
  if (!data?.onboarding_completed_at) redirect("/onboarding");
  return user;
}

export async function redirectIfAuthenticated() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(await getSessionDestination());
}

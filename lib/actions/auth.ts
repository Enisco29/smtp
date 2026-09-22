"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/actions/state";
import { getSessionDestination } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, signupSchema } from "@/lib/validation/auth";

export async function loginAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { status: "error", message: "Email or password is incorrect." };
  redirect(await getSessionDestination());
}

export async function signupAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { status: "error", message: error.message };
  if (data.session) redirect("/onboarding");
  redirect(`/check-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

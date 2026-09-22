"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/actions/state";
import { requireUser } from "@/lib/auth/guards";
import { encryptSecret } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { consumeSmtpVerificationAttempt } from "@/lib/smtp/rate-limit";
import { verifyGmailCredentials } from "@/lib/smtp/verify";
import { onboardingSchema } from "@/lib/validation/smtp";

export async function completeOnboardingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("onboarding_completed_at").eq("id", user.id).maybeSingle();
  if (profile?.onboarding_completed_at) redirect("/dashboard");

  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const rateLimit = await consumeSmtpVerificationAttempt();
  if (!rateLimit.allowed) return { status: "error", message: rateLimit.message };

  const verified = await verifyGmailCredentials(parsed.data.senderEmail, parsed.data.appPassword);
  if (!verified.ok) return { status: "error", message: verified.message };

  const encryptedPassword = encryptSecret(parsed.data.appPassword);
  const admin = createAdminClient();
  const { error } = await admin.rpc("complete_onboarding_admin", {
    p_user_id: user.id,
    p_name: parsed.data.name,
    p_sender_name: parsed.data.senderName,
    p_sender_email: parsed.data.senderEmail,
    p_encrypted_password: encryptedPassword,
  });
  if (error) return { status: "error", message: "We verified Gmail but could not save your settings. Please try again." };
  redirect("/dashboard");
}

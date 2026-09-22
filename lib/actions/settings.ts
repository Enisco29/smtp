"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions/state";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { consumeSmtpVerificationAttempt } from "@/lib/smtp/rate-limit";
import { verifyGmailCredentials } from "@/lib/smtp/verify";
import { settingsSchema } from "@/lib/validation/smtp";

export async function updateSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireOnboardedUser();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: current, error: metadataError } = await supabase
    .from("smtp_accounts")
    .select("sender_email")
    .eq("user_id", user.id)
    .single();
  if (metadataError || !current) return { status: "error", message: "Your SMTP configuration could not be loaded." };

  const emailChanged = current.sender_email.toLowerCase() !== parsed.data.senderEmail.toLowerCase();
  const passwordChanged = Boolean(parsed.data.appPassword);
  let encryptedPassword: string | null = null;

  if (emailChanged || passwordChanged) {
    const limit = await consumeSmtpVerificationAttempt();
    if (!limit.allowed) return { status: "error", message: limit.message };

    let password = parsed.data.appPassword;
    if (!passwordChanged) {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("get_smtp_secret_admin", { p_user_id: user.id });
      if (error || typeof data !== "string") return { status: "error", message: "Your existing credential could not be loaded securely." };
      try {
        password = decryptSecret(data);
      } catch {
        return { status: "error", message: "Your stored credential could not be read. Enter a new App Password." };
      }
    }

    const verified = await verifyGmailCredentials(parsed.data.senderEmail, password);
    if (!verified.ok) return { status: "error", message: verified.message };
    if (passwordChanged) encryptedPassword = encryptSecret(password);
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("update_smtp_settings_admin", {
    p_user_id: user.id,
    p_sender_name: parsed.data.senderName,
    p_sender_email: parsed.data.senderEmail,
    p_encrypted_password: encryptedPassword,
  });
  if (error) return { status: "error", message: "Your settings could not be saved. Your previous configuration is unchanged." };

  revalidatePath("/settings");
  return { status: "success", message: "Sender settings updated." };
}

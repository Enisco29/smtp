import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function consumeSmtpVerificationAttempt() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_smtp_verification_attempt");
  if (error) return { allowed: false, message: "Credential verification is temporarily unavailable. Please try again shortly." };
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.allowed) {
    const minutes = Math.max(1, Math.ceil(Number(result?.retry_after_seconds ?? 60) / 60));
    return { allowed: false, message: `Too many verification attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }
  return { allowed: true as const };
}

"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions/state";
import { encryptAiKey } from "@/lib/ai/keys";
import { isAiProvider } from "@/lib/ai/providers";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateAiProviderAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireOnboardedUser();
  const provider = formData.get("provider");
  const operation = formData.get("operation");
  if (!isAiProvider(provider) || !["save", "select", "remove"].includes(String(operation))) {
    return { status: "error", message: "Choose a valid provider and action." };
  }
  let encrypted: string | null = null;
  if (operation === "save") {
    const key = formData.get("apiKey");
    if (typeof key !== "string" || !key.trim() || key.length > 1000) {
      return { status: "error", message: "Enter a provider API key of at most 1,000 characters." };
    }
    try { encrypted = encryptAiKey(key.trim()); }
    catch { return { status: "error", message: "AI key encryption is not configured on the server." }; }
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("manage_ai_provider_admin", {
    p_user_id: user.id, p_provider: provider, p_operation: operation, p_encrypted_key: encrypted,
  });
  if (error) return { status: "error", message: "Could not update this provider. Save its key before selecting it." };
  revalidatePath("/settings");
  revalidatePath("/campaigns");
  return { status: "success", message: "AI provider settings updated." };
}

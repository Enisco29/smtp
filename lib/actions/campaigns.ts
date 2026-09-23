"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/actions/state";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { campaignSchema } from "@/lib/campaigns/validation";
import { createClient } from "@/lib/supabase/server";

export async function createCampaignAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireOnboardedUser();
  const parsed = campaignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase.from("campaigns")
    .insert({ user_id: user.id, name: parsed.data.name, instructions: parsed.data.instructions, status: "draft" })
    .select("id")
    .single();
  if (error || !data) return { status: "error", message: "Could not create the campaign. Please try again." };
  revalidatePath("/campaigns");
  redirect(`/campaigns/${data.id}`);
}

export async function deleteCampaignAction(id: string, _: ActionState): Promise<ActionState> {
  void _;
  const user = await requireOnboardedUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("campaigns")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error || !data) return { status: "error", message: "This campaign could not be deleted. Only your draft campaigns can be deleted." };
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  redirect("/campaigns");
}

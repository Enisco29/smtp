"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/actions/state";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export async function finishCampaignAction(campaignId: string, _: ActionState): Promise<ActionState> {
  void _;
  await requireOnboardedUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("finish_campaign", { p_campaign_id: campaignId });
  if (error) {
    return {
      status: "error",
      message: error.message.includes("still in progress")
        ? "An email is still being processed. Wait a moment, refresh, and try again."
        : "The campaign could not be finished.",
    };
  }
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/drafts`);
  redirect(`/campaigns/${campaignId}`);
}

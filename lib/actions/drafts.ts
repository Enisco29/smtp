"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions/state";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { draftContentSchema } from "@/lib/drafts/workflow";
import { createClient } from "@/lib/supabase/server";

function messageFor(error: { message?: string } | null, fallback: string) {
  const message = error?.message ?? "";
  if (/changed|eligible|editable|restored|excluded|busy/i.test(message)) {
    return "This draft changed in another tab. Refresh and try again.";
  }
  return fallback;
}

async function mutate(
  campaignId: string,
  draftId: string,
  revision: number,
  rpc: "approve_email_draft" | "exclude_email_draft" | "restore_email_draft",
  success: string,
): Promise<ActionState> {
  await requireOnboardedUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, {
    p_draft_id: draftId,
    p_expected_revision: revision,
  });
  if (error) return { status: "error", message: messageFor(error, "The draft could not be updated.") };
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/drafts`);
  revalidatePath(`/campaigns/${campaignId}/drafts/${draftId}`);
  return { status: "success", message: success };
}

export async function editDraftAction(
  campaignId: string,
  draftId: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  void _;
  await requireOnboardedUser();
  const parsed = draftContentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_email_draft", {
    p_draft_id: draftId,
    p_expected_revision: parsed.data.revision,
    p_subject: parsed.data.subject,
    p_body: parsed.data.body,
  });
  if (error) return { status: "error", message: messageFor(error, "The draft could not be saved.") };
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/drafts`);
  revalidatePath(`/campaigns/${campaignId}/drafts/${draftId}`);
  return { status: "success", message: "Draft saved. It must be approved again." };
}

export async function approveDraftAction(campaignId: string, draftId: string, revision: number, _: ActionState) {
  void _;
  return mutate(campaignId, draftId, revision, "approve_email_draft", "Draft approved.");
}

export async function excludeDraftAction(campaignId: string, draftId: string, revision: number, _: ActionState) {
  void _;
  return mutate(campaignId, draftId, revision, "exclude_email_draft", "Recipient excluded.");
}

export async function restoreDraftAction(campaignId: string, draftId: string, revision: number, _: ActionState) {
  void _;
  return mutate(campaignId, draftId, revision, "restore_email_draft", "Recipient restored. Approval is required again.");
}

export async function approveAllDraftsAction(campaignId: string, _: ActionState): Promise<ActionState> {
  void _;
  await requireOnboardedUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_all_email_drafts", { p_campaign_id: campaignId });
  if (error) return { status: "error", message: "Eligible drafts could not be approved." };
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/drafts`);
  return { status: "success", message: `${Number(data ?? 0)} draft${Number(data) === 1 ? "" : "s"} approved.` };
}

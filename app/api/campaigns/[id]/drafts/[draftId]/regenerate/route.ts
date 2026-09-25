import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateEmail, safeAiFailure } from "@/lib/ai/generate-email";
import { AiConfigurationError, loadUserAiProvider } from "@/lib/ai/user-provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  revision: z.number().int().positive(),
  instructions: z.string().trim().max(1000).optional().default(""),
});

export async function POST(request: Request, { params }: {
  params: Promise<{ id: string; draftId: string }>;
}) {
  const { id, draftId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Invalid regeneration request." }, { status: 400 });

  const { data: campaign } = await supabase.from("campaigns")
    .select("id, instructions, status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!campaign) return Response.json({ message: "Campaign not found." }, { status: 404 });
  if (campaign.status !== "draft") return Response.json({ message: "Only draft campaigns can be changed." }, { status: 409 });
  const { data: draft } = await supabase.from("email_drafts")
    .select("id, subject, body, status, content_revision, recipients(email, data)")
    .eq("id", draftId).eq("campaign_id", id).maybeSingle();
  if (!draft || !draft.subject || !draft.body || draft.status === "excluded") {
    return Response.json({ message: "This draft cannot be regenerated." }, { status: 409 });
  }

  const { data: token, error: claimError } = await supabase.rpc("claim_review_ai", {
    p_draft_id: draftId, p_expected_revision: parsed.data.revision,
  });
  if (claimError || typeof token !== "string") {
    return Response.json({ message: "This draft changed or another AI request is running. Refresh and try again." }, { status: 409 });
  }
  let config: Awaited<ReturnType<typeof loadUserAiProvider>>;
  try {
    config = await loadUserAiProvider(supabase, user.id);
  } catch (error) {
    await createAdminClient().rpc("release_review_ai_admin", { p_user_id: user.id, p_draft_id: draftId, p_token: token });
    const failure = error instanceof AiConfigurationError ? error : new AiConfigurationError(503, "AI configuration could not be loaded.");
    return Response.json({ message: failure.message }, { status: failure.status });
  }
  const recipient = draft.recipients as unknown as { email: string; data: Record<string, unknown> };
  try {
    const result = await generateEmail({
      provider: config.provider, apiKey: config.apiKey, model: config.model,
      instructions: campaign.instructions, recipient, mode: "regenerate",
      currentDraft: { subject: draft.subject, body: draft.body },
      reviewInstructions: parsed.data.instructions,
    });
    const { data: saved } = await config.admin.rpc("complete_review_ai_admin", {
      p_user_id: user.id, p_draft_id: draftId, p_token: token,
      p_expected_revision: parsed.data.revision, p_content_state: "generated",
      p_subject: result.subject, p_body: result.body,
    });
    if (!saved) return Response.json({ message: "The draft changed while AI was working. The older result was discarded." }, { status: 409 });
    revalidatePath(`/campaigns/${id}`);
    revalidatePath(`/campaigns/${id}/drafts`);
    revalidatePath(`/campaigns/${id}/drafts/${draftId}`);
    return Response.json({ ...result, revision: parsed.data.revision + 1 });
  } catch (error) {
    await config.admin.rpc("release_review_ai_admin", { p_user_id: user.id, p_draft_id: draftId, p_token: token });
    return Response.json({ message: "Regeneration failed. Your existing draft was preserved.", code: safeAiFailure(error) }, { status: 502 });
  }
}

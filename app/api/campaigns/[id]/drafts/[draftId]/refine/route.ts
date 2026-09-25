import { z } from "zod";
import { generateEmail, safeAiFailure } from "@/lib/ai/generate-email";
import { AiConfigurationError, loadUserAiProvider } from "@/lib/ai/user-provider";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  revision: z.number().int().positive(),
  instructions: z.string().trim().min(1).max(1000),
});

export async function POST(request: Request, { params }: {
  params: Promise<{ id: string; draftId: string }>;
}) {
  const { id, draftId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid refinement request." }, { status: 400 });
  const { data: campaign } = await supabase.from("campaigns")
    .select("id, instructions, status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!campaign) return Response.json({ message: "Campaign not found." }, { status: 404 });
  if (campaign.status !== "draft") return Response.json({ message: "Only draft campaigns can be changed." }, { status: 409 });
  const { data: draft } = await supabase.from("email_drafts")
    .select("subject, body, status, content_revision, recipients(email, data)")
    .eq("id", draftId).eq("campaign_id", id).maybeSingle();
  if (!draft || !draft.subject || !draft.body || draft.status === "excluded" || draft.content_revision !== parsed.data.revision) {
    return Response.json({ message: "This draft changed. Refresh before refining it." }, { status: 409 });
  }
  try {
    const config = await loadUserAiProvider(supabase, user.id);
    const recipient = draft.recipients as unknown as { email: string; data: Record<string, unknown> };
    const result = await generateEmail({
      provider: config.provider, apiKey: config.apiKey, model: config.model,
      instructions: campaign.instructions, recipient, mode: "refine",
      currentDraft: { subject: draft.subject, body: draft.body },
      reviewInstructions: parsed.data.instructions,
    });
    return Response.json({ original: { subject: draft.subject, body: draft.body }, proposed: result, baseRevision: draft.content_revision });
  } catch (error) {
    const message = error instanceof AiConfigurationError ? error.message : "AI refinement failed. Your draft was not changed.";
    const status = error instanceof AiConfigurationError ? error.status : 502;
    return Response.json({ message, code: safeAiFailure(error) }, { status });
  }
}

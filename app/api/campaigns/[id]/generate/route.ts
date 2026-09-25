import { revalidatePath } from "next/cache";
import { decryptAiKey } from "@/lib/ai/keys";
import { generateEmail, safeAiFailure } from "@/lib/ai/generate-email";
import { isAiProvider, type AiProvider } from "@/lib/ai/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const modelVariables: Record<AiProvider, string> = {
  openai: "OPENAI_MODEL_ID",
  groq: "GROQ_MODEL_ID",
  claude: "CLAUDE_MODEL_ID",
  gemini: "GEMINI_MODEL_ID",
};

type Claim = {
  draft_id: string;
  recipient_id: string;
  recipient_email: string;
  recipient_data: Record<string, unknown>;
  token: string;
};

async function counts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
  total: number,
) {
  const [generated, failed, processing] = await Promise.all(
    ["generated", "failed", "processing"].map((status) =>
      supabase
        .from("email_drafts")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", status),
    ),
  );
  if (generated.error || failed.error || processing.error)
    throw new Error("Could not load generation progress.");
  const generatedCount = generated.count ?? 0;
  const failedCount = failed.count ?? 0;
  const processingCount = processing.count ?? 0;
  return {
    total,
    generated: generatedCount,
    failed: failedCount,
    pending: Math.max(
      0,
      total - generatedCount - failedCount - processingCount,
    ),
    processing: processingCount,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return Response.json({ message: "Please sign in again." }, { status: 401 });
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, instructions, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!campaign)
    return Response.json({ message: "Campaign not found." }, { status: 404 });
  if (campaign.status !== "draft")
    return Response.json(
      { message: "Only draft campaigns can generate emails." },
      { status: 409 },
    );
  const { count: recipientCount, error: recipientError } = await supabase
    .from("recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id);
  if (recipientError || !recipientCount)
    return Response.json(
      { message: "Import recipients before generating drafts." },
      { status: 409 },
    );

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_ai_provider")
    .eq("id", user.id)
    .maybeSingle();
  if (!isAiProvider(profile?.active_ai_provider)) {
    return Response.json(
      { message: "Choose an AI provider and save its API key in Settings." },
      { status: 409 },
    );
  }
  const provider = profile.active_ai_provider;
  const model = process.env[modelVariables[provider]];
  if (!model)
    return Response.json(
      {
        message: `${modelVariables[provider]} is not configured on the server.`,
      },
      { status: 503 },
    );
  const generationModel = model;
  const campaignInstructions = campaign.instructions;
  const actorId = user.id;

  let retryFailed = false;
  try {
    retryFailed =
      ((await request.json()) as { retryFailed?: unknown }).retryFailed ===
      true;
  } catch {
    return Response.json(
      { message: "Invalid generation request." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: encrypted, error: keyError } = await admin.rpc(
    "get_ai_key_admin",
    { p_user_id: user.id, p_provider: provider },
  );
  if (keyError || typeof encrypted !== "string") {
    return Response.json(
      {
        message:
          "Your selected provider has no saved API key. Add one in Settings.",
      },
      { status: 409 },
    );
  }
  let apiKey: string;
  try {
    apiKey = decryptAiKey(encrypted);
  } catch {
    return Response.json(
      {
        message: "The saved AI key could not be read. Replace it in Settings.",
      },
      { status: 503 },
    );
  }

  const { data, error: claimError } = await admin.rpc(
    "claim_campaign_drafts_admin",
    {
      p_user_id: user.id,
      p_campaign_id: id,
      p_limit: 6,
      p_retry_failed: retryFailed,
    },
  );

  if (claimError) {
    console.error("CLAIM DRAFTS RPC ERROR:", {
      message: claimError.message,
      code: claimError.code,
      details: claimError.details,
      hint: claimError.hint,
    });

    return Response.json(
      {
        message:
          "Could not claim drafts. Check that this is still your draft campaign.",
      },
      { status: 409 },
    );
  }
  const claims = (data ?? []) as Claim[];
  let next = 0;
  let haltReason: "invalid_key" | "rate_limited" | null = null;
  async function worker() {
    while (next < claims.length) {
      const claim = claims[next++];
      try {
        const draft = await generateEmail({
          provider,
          apiKey,
          model: generationModel,
          instructions: campaignInstructions,
          recipient: {
            email: claim.recipient_email,
            data: claim.recipient_data,
          },
        });
        await admin.rpc("complete_campaign_draft_admin", {
          p_user_id: actorId,
          p_draft_id: claim.draft_id,
          p_token: claim.token,
          p_status: "generated",
          p_subject: draft.subject,
          p_body: draft.body,
        });
      } catch (failure) {
        const code = safeAiFailure(failure);
        if (code === "invalid_key") haltReason = "invalid_key";
        else if (code === "rate_limited" && !haltReason)
          haltReason = "rate_limited";
        await admin.rpc("complete_campaign_draft_admin", {
          p_user_id: actorId,
          p_draft_id: claim.draft_id,
          p_token: claim.token,
          p_status: "failed",
          p_failure_code: code,
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(3, claims.length) }, () => worker()),
  );
  revalidatePath(`/campaigns/${id}`);
  try {
    const progress = await counts(supabase, id, recipientCount);
    return Response.json({ ...progress, claimed: claims.length, haltReason });
  } catch {
    return Response.json(
      {
        message:
          "Drafts were processed, but progress could not be loaded. Refresh the page.",
      },
      { status: 503 },
    );
  }
}

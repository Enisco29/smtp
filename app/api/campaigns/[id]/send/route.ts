import { revalidatePath } from "next/cache";
import { decryptSecret } from "@/lib/security/encryption";
import { sendGmailMessage } from "@/lib/smtp/send";
import { getSmtpSendConfig, hasSmtpAttemptBudget, SMTP_MIN_ATTEMPT_BUDGET_MS, SMTP_ROUTE_BUDGET_MS } from "@/lib/smtp/send-config";
import { consumeSmtpVerificationAttempt } from "@/lib/smtp/rate-limit";
import { z } from "zod";
import { verifyGmailCredentials } from "@/lib/smtp/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Claim = {
  draft_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  token: string;
  attempt_number: number;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function progress(supabase: Awaited<ReturnType<typeof createClient>>, campaignId: string) {
  const statuses = ["approved", "sending", "sent", "send_failed", "uncertain", "excluded"] as const;
  const results = await Promise.all(statuses.map((status) => supabase.from("email_drafts")
    .select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", status)));
  if (results.some((result) => result.error)) throw new Error("Progress unavailable");
  const values = Object.fromEntries(statuses.map((status, index) => [status, results[index].count ?? 0])) as Record<(typeof statuses)[number], number>;
  const { count: retryable } = await supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "send_failed").eq("send_retryable", true);
  return {
    retryable: retryable ?? 0,
    total: values.approved + values.sending + values.sent + values.send_failed + values.uncertain,
    sent: values.sent,
    pending: values.approved + values.sending,
    failed: values.send_failed,
    uncertain: values.uncertain,
    excluded: values.excluded,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const started = Date.now();
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  const parsed = z.object({ confirmed: z.literal(true), senderEmail: z.string().email(), retryFailed: z.boolean().optional(), draftId: z.string().uuid().optional(), retryBefore: z.string().datetime().optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Invalid sending request." }, { status: 400 });
  const input = parsed.data;
  const retryFailed = input.retryFailed === true;
  const draftId = typeof input.draftId === "string" ? input.draftId : null;
  const { data: campaign } = await supabase.from("campaigns").select("id, status")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!campaign) return Response.json({ message: "Campaign not found." }, { status: 404 });
  if (!["draft", "sending"].includes(campaign.status)) {
    return Response.json({ message: "This campaign is closed for sending." }, { status: 409 });
  }

  const admin = createAdminClient();
  const config = getSmtpSendConfig();
  const { error: policyError } = await admin.rpc("configure_smtp_send_policy_admin", { p_daily_limit: config.dailyLimit, p_delay_ms: config.delayMs });
  if (policyError) return Response.json({ message: "Sending limits could not be configured." }, { status: 503 });
  if (campaign.status === "draft") {
    const [{ data: sender }, { data: encrypted }] = await Promise.all([
      supabase.from("smtp_accounts").select("sender_email").eq("user_id", user.id).maybeSingle(),
      admin.rpc("get_smtp_secret_admin", { p_user_id: user.id }),
    ]);
    if (!sender || typeof encrypted !== "string") return Response.json({ message: "Your Gmail sender configuration is incomplete." }, { status: 409 });
    let password: string;
    try { password = decryptSecret(encrypted); }
    catch { return Response.json({ message: "Your saved Gmail credential could not be read. Update it in Settings." }, { status: 503 }); }
    if (sender.sender_email !== input.senderEmail) return Response.json({ message: "Sender settings changed. Refresh the confirmation page." }, { status: 409 });
    const rate = await consumeSmtpVerificationAttempt();
    if (!rate.allowed) return Response.json({ message: rate.message }, { status: 429 });
    const verified = await verifyGmailCredentials(sender.sender_email, password);
    if (!verified.ok) return Response.json({ message: verified.message }, { status: 409 });
    const { error } = await admin.rpc("start_campaign_sending_admin", { p_user_id: user.id, p_campaign_id: id, p_expected_email: sender.sender_email, p_expected_secret: encrypted });
    if (error) return Response.json({ message: "The campaign could not start sending. Confirm that it still has approved drafts." }, { status: 409 });
  }

  const { data: sender } = await supabase.from("campaign_senders")
    .select("sender_name, sender_email, credential_status").eq("campaign_id", id).maybeSingle();
  if (!sender) return Response.json({ message: "The frozen campaign sender could not be loaded." }, { status: 409 });
  if (sender.sender_email !== input.senderEmail) return Response.json({ message: "Sender mismatch. Refresh the confirmation page." }, { status: 409 });
  if (sender.credential_status !== "valid") {
    return Response.json({ message: "Reconnect this campaign’s Gmail App Password before resuming." }, { status: 409 });
  }
  const { data: encrypted } = await admin.rpc("get_campaign_smtp_secret_admin", { p_user_id: user.id, p_campaign_id: id });
  if (typeof encrypted !== "string") return Response.json({ message: "The campaign credential could not be loaded securely." }, { status: 503 });
  let appPassword: string;
  try { appPassword = decryptSecret(encrypted); }
  catch { return Response.json({ message: "The campaign credential could not be decrypted." }, { status: 503 }); }

  let processed = 0;
  let haltReason: string | null = null;
  while (processed < config.batchSize) {
    if (request.signal.aborted) break;
    if (!hasSmtpAttemptBudget(started, config.delayMs)) break;
    await wait(config.delayMs);
    if (request.signal.aborted || SMTP_ROUTE_BUDGET_MS - (Date.now() - started) < SMTP_MIN_ATTEMPT_BUDGET_MS) break;
    const { data, error } = await supabase.rpc("claim_next_email_send", {
      p_campaign_id: id,
      p_daily_limit: config.dailyLimit,
      p_retry_failed: retryFailed,
      p_draft_id: draftId,
      p_retry_before: input.retryBefore ?? new Date(started).toISOString(),
    });
    if (error) {
      haltReason = error.message.includes("Daily sending limit") ? "daily_limit" : error.message.includes("sender unavailable") ? "sender_unavailable" : "claim_failed";
      break;
    }
    const claim = (data?.[0] ?? null) as Claim | null;
    if (!claim) { haltReason = "idle"; break; }
    const result = await sendGmailMessage({
      senderName: sender.sender_name,
      senderEmail: sender.sender_email,
      appPassword,
      recipientEmail: claim.recipient_email,
      subject: claim.subject,
      body: claim.body,
    });
    const final = result.status === "sent"
      ? { p_status: "sent", p_error_code: null, p_error_message: null, p_retryable: false }
      : { p_status: result.status, p_error_code: result.code, p_error_message: result.message, p_retryable: result.retryable };
    const { data: saved } = await supabase.rpc("finalize_email_send", {
      p_campaign_id: id, p_draft_id: claim.draft_id, p_token: claim.token, ...final,
    });
    if (!saved) { haltReason = "stale_claim"; break; }
    processed += 1;
    if (result.status !== "sent" && result.halt) { haltReason = result.code; break; }
    if (draftId) break;
  }
  revalidatePath(`/campaigns/${id}`);
  revalidatePath(`/campaigns/${id}/drafts`);
  revalidatePath(`/campaigns/${id}/send`);
  try {
    return Response.json({ ...(await progress(supabase, id)), processed, haltReason });
  } catch {
    return Response.json({ message: "Sending progress was saved, but totals could not be refreshed." }, { status: 503 });
  }
}

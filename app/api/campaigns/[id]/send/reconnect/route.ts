import { revalidatePath } from "next/cache";
import { z } from "zod";
import { encryptSecret } from "@/lib/security/encryption";
import { consumeSmtpVerificationAttempt } from "@/lib/smtp/rate-limit";
import { verifyGmailCredentials } from "@/lib/smtp/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const schema = z.object({ appPassword: z.string().transform((value) => value.replace(/\s/g, "")).pipe(z.string().min(1)) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Enter a Google App Password." }, { status: 400 });
  const { data: campaign } = await supabase.from("campaigns").select("status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!campaign || campaign.status !== "sending") return Response.json({ message: "Only an active campaign can reconnect." }, { status: 409 });
  const { data: sender } = await supabase.from("campaign_senders").select("sender_email")
    .eq("campaign_id", id).eq("user_id", user.id).maybeSingle();
  if (!sender) return Response.json({ message: "Campaign sender not found." }, { status: 404 });
  const rate = await consumeSmtpVerificationAttempt();
  if (!rate.allowed) return Response.json({ message: rate.message }, { status: 429 });
  const verified = await verifyGmailCredentials(sender.sender_email, parsed.data.appPassword);
  if (!verified.ok) return Response.json({ message: verified.message }, { status: 409 });
  const admin = createAdminClient();
  const { error } = await admin.rpc("reconnect_campaign_smtp_admin", {
    p_user_id: user.id, p_campaign_id: id, p_encrypted_password: encryptSecret(parsed.data.appPassword),
  });
  if (error) return Response.json({ message: "The campaign credential could not be updated." }, { status: 409 });
  revalidatePath(`/campaigns/${id}/send`);
  return Response.json({ message: "Gmail reconnected. You can resume sending." });
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

type Authorized = { supabase: SupabaseClient; userId: string; response?: never };
type Rejected = { response: Response; supabase?: never; userId?: never };

export async function authorizeDraftImport(request: Request, campaignId: string): Promise<Authorized | Rejected> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    // Malformed origins are rejected below.
  }
  if (!originHost || !host || originHost !== host) {
    return { response: Response.json({ message: "Invalid request origin." }, { status: 403 }) };
  }

  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 2 * 1024 * 1024 + 100_000) {
    return { response: Response.json({ message: "The CSV file must be 2 MB or smaller." }, { status: 413 }) };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: Response.json({ message: "Please log in again." }, { status: 401 }) };

  const { data: profile } = await supabase.from("profiles")
    .select("onboarding_completed_at").eq("id", user.id).maybeSingle();
  if (!profile?.onboarding_completed_at) {
    return { response: Response.json({ message: "Complete onboarding before importing recipients." }, { status: 403 }) };
  }

  const { data: campaign } = await supabase.from("campaigns")
    .select("id, status").eq("id", campaignId).eq("user_id", user.id).maybeSingle();
  if (!campaign) return { response: Response.json({ message: "Campaign not found." }, { status: 404 }) };
  if (campaign.status !== "draft") {
    return { response: Response.json({ message: "Recipients can only be imported into draft campaigns." }, { status: 409 }) };
  }
  return { supabase, userId: user.id };
}

export async function getImportForm(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return { response: Response.json({ message: "Choose a CSV file." }, { status: 400 }) };
    return { file, token: form.get("token") };
  } catch {
    return { response: Response.json({ message: "Could not read the uploaded file." }, { status: 400 }) };
  }
}

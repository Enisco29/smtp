import { createClient } from "@/lib/supabase/server";

export async function CampaignStatusSummary({ campaignId, status }: { campaignId: string; status: string }) {
  if (status === "draft") return <span className="text-xs text-[#71807b]">Draft preparation</span>;
  const supabase = await createClient();
  const states = ["sent", "approved", "sending", "send_failed", "uncertain"] as const;
  const results = await Promise.all(states.map((state) => supabase.from("email_drafts")
    .select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", state)));
  const values = Object.fromEntries(states.map((state, index) => [state, results[index].count ?? 0])) as Record<(typeof states)[number], number>;
  return <span className="text-xs text-[#71807b]">{values.sent} sent · {values.approved + values.sending} pending · {values.send_failed} failed · {values.uncertain} uncertain</span>;
}

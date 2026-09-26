import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { GenerateDrafts } from "@/components/forms/generate-drafts";
import { createClient } from "@/lib/supabase/server";

export async function CampaignDraftSummary({ campaignId, recipientCount, isDraft }: {
  campaignId: string; recipientCount: number; isDraft: boolean;
}) {
  const supabase = await createClient();
  const statuses = ["generated", "edited", "approved", "excluded", "failed", "processing", "sending", "sent", "send_failed", "uncertain"] as const;
  const results = await Promise.all(statuses.map((status) => supabase.from("email_drafts")
    .select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", status)));
  const counts = Object.fromEntries(statuses.map((status, index) => [status, results[index].count ?? 0])) as Record<(typeof statuses)[number], number>;
  const successful = counts.generated + counts.edited + counts.approved + counts.excluded + counts.sending + counts.sent + counts.send_failed + counts.uncertain;
  const pending = Math.max(0, recipientCount - successful - counts.failed - counts.processing);
  const hasError = results.some((result) => result.error);

  return <section className="mt-10">
    {isDraft && recipientCount > 0 ? <GenerateDrafts campaignId={campaignId} total={recipientCount} generated={successful} failed={counts.failed} processing={counts.processing} pending={pending} /> : null}
    <div className="card mt-6 flex flex-wrap items-center justify-between gap-5 rounded-2xl p-6"><div><h2 className="text-xl font-bold tracking-[-.03em]">Draft review</h2><p className="mt-1 text-sm text-[#65736f]">{counts.approved} approved · {counts.sent} sent · {counts.send_failed} send failed · {counts.uncertain} uncertain</p>{hasError ? <p role="alert" className="mt-2 text-sm text-[#b42318]">Could not load all draft totals.</p> : null}</div><div className="flex flex-wrap gap-3"><Link className="button-primary" href={`/campaigns/${campaignId}/drafts`}>Review Drafts <ArrowRight size={17} /></Link><Link className="button-secondary" href={`/campaigns/${campaignId}/send`}>Delivery log</Link></div></div>
  </section>;
}

import Link from "next/link";
import { GenerateDrafts } from "@/components/forms/generate-drafts";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 20;

export async function CampaignDrafts({ campaignId, recipientCount, isDraft, page }: {
  campaignId: string; recipientCount: number; isDraft: boolean; page: number;
}) {
  const supabase = await createClient();
  const [generated, failed, processing, list] = await Promise.all([
    supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "generated"),
    supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "failed"),
    supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "processing"),
    supabase.from("email_drafts").select("id, subject, status, failure_code, recipients(email, data)", { count: "exact" })
      .eq("campaign_id", campaignId).order("updated_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  ]);
  const generatedCount = generated.count ?? 0;
  const failedCount = failed.count ?? 0;
  const processingCount = processing.count ?? 0;
  const pendingCount = Math.max(0, recipientCount - generatedCount - failedCount - processingCount);
  const totalPages = Math.max(1, Math.ceil((list.count ?? 0) / PAGE_SIZE));

  return <section className="mt-10">
    {isDraft && recipientCount > 0 ? <GenerateDrafts campaignId={campaignId} total={recipientCount} generated={generatedCount} failed={failedCount} processing={processingCount} pending={pendingCount} /> : null}
    <div className="mt-8"><h2 className="text-xl font-bold tracking-[-.03em]">Email drafts</h2><p className="mt-1 text-sm text-[#65736f]">{generatedCount} generated · {failedCount} failed · {pendingCount + processingCount} pending</p></div>
    {list.error || generated.error || failed.error || processing.error ? <p role="alert" className="mt-4 text-sm text-[#b42318]">Could not load draft progress. Please refresh the page.</p> : null}
    {!list.error && !list.count ? <div className="mt-5 rounded-2xl border border-dashed border-[#b9c9c3] bg-white/50 p-8 text-center text-sm text-[#65736f]">No drafts yet. Generate drafts after importing recipients.</div> : null}
    {list.data?.length ? <div className="card mt-5 overflow-x-auto rounded-2xl"><table className="min-w-full text-left text-sm"><thead className="border-b border-[#e6ece9] bg-[#f7faf8] text-xs font-semibold text-[#60716a]"><tr><th className="px-5 py-3">Recipient</th><th className="px-5 py-3">Subject</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#edf1ef]">{list.data.map((draft) => {
      const recipient = draft.recipients as { email?: string; data?: Record<string, unknown> } | null;
      const name = [recipient?.data?.first_name, recipient?.data?.last_name].filter(Boolean).join(" ");
      return <tr key={draft.id}><td className="px-5 py-3"><span className="font-medium">{name || recipient?.email || "Recipient"}</span>{name ? <span className="block text-xs text-[#71807b]">{recipient?.email}</span> : null}</td><td className="max-w-80 truncate px-5 py-3 text-[#53645f]" title={draft.subject ?? ""}>{draft.subject ?? "—"}</td><td className="px-5 py-3 capitalize text-[#53645f]">{draft.status}{draft.failure_code ? <span className="block text-xs text-[#b42318]">{draft.failure_code.replaceAll("_", " ")}</span> : null}</td></tr>;
    })}</tbody></table></div> : null}
    {(list.count ?? 0) > PAGE_SIZE ? <nav aria-label="Draft pages" className="mt-4 flex justify-between text-sm"><span>Page {Math.min(page, totalPages)} of {totalPages}</span><div className="flex gap-2"><Link className={`button-secondary ${page <= 1 ? "pointer-events-none opacity-50" : ""}`} href={`/campaigns/${campaignId}?draftPage=${page - 1}`}>Previous</Link><Link className={`button-secondary ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`} href={`/campaigns/${campaignId}?draftPage=${page + 1}`}>Next</Link></div></nav> : null}
  </section>;
}

import type { Metadata } from "next";
import { ArrowLeft, ChevronLeft, ChevronRight, Mail } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignDraftSummary } from "@/components/campaign-draft-summary";
import { DeleteCampaignForm } from "@/components/forms/delete-campaign-form";
import { RecipientImport } from "@/components/forms/recipient-import";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Campaign" };
const PAGE_SIZE = 50;

export default async function CampaignPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireOnboardedUser();
  const { id } = await params;
  const pageValue = Number((await searchParams).page ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const supabase = await createClient();
  const { data: campaign, error } = await supabase.from("campaigns")
    .select("id, name, instructions, status, created_at")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error || !campaign) notFound();

  const { data: recipients, count, error: recipientsError } = await supabase.from("recipients")
    .select("id, email, data, status, email_drafts(status)", { count: "exact" })
    .eq("campaign_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const recipientCount = count ?? 0;
  const columns = Array.from(new Set((recipients ?? []).flatMap((recipient) => Object.keys(recipient.data ?? {})))).sort();
  const totalPages = Math.max(1, Math.ceil(recipientCount / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm font-semibold text-[#53645f] hover:text-[#146c54]"><ArrowLeft size={16} /> Campaigns</Link>
      <div className="mt-8 flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><h1 className="break-words text-3xl font-bold tracking-[-.04em] sm:text-4xl">{campaign.name}</h1><span className="rounded-full bg-[#eef7f3] px-3 py-1 text-xs font-bold capitalize text-[#146c54]">{campaign.status.replaceAll("_", " ")}</span></div><p className="mt-2 text-sm text-[#71807b]">Created {new Date(campaign.created_at).toLocaleDateString()}</p></div>
        {campaign.status === "draft" ? <DeleteCampaignForm id={campaign.id} /> : null}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(180px,1fr)]">
        <section className="card rounded-2xl p-6"><h2 className="font-bold">Email instructions</h2><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-[#53645f]">{campaign.instructions}</p></section>
        <section className="card rounded-2xl p-6"><span className="grid size-10 place-items-center rounded-xl bg-[#e5f3ed] text-[#146c54]"><Mail size={20} /></span><p className="mt-5 text-3xl font-bold tracking-[-.04em]">{recipientCount}</p><p className="text-sm text-[#65736f]">Recipients</p></section>
      </div>

      {campaign.status === "draft" ? <section className="mt-9"><h2 className="text-xl font-bold tracking-[-.03em]">Upload recipients</h2><p className="mt-2 text-sm leading-6 text-[#65736f]">Upload a CSV with an <span className="font-semibold">email</span> column. You can fix and re-upload a file without recreating this campaign.</p><div className="mt-4"><RecipientImport campaignId={campaign.id} hasRecipients={recipientCount > 0} /></div></section> : null}

      <CampaignDraftSummary campaignId={campaign.id} recipientCount={recipientCount} isDraft={["draft", "sending"].includes(campaign.status)} />

      <section className="mt-10"><div className="flex items-end justify-between"><div><h2 className="text-xl font-bold tracking-[-.03em]">Recipient list</h2><p className="mt-1 text-sm text-[#65736f]">{recipientCount} saved recipient{recipientCount === 1 ? "" : "s"}</p></div></div>
        {recipientsError ? <p role="alert" className="mt-5 text-sm text-[#b42318]">Could not load recipients. Please refresh the page.</p> : null}
        {!recipientsError && recipientCount === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-[#b9c9c3] bg-white/50 p-8 text-center text-sm text-[#65736f]">No recipients saved yet. Preview a CSV and confirm the import to add them.</div> : null}
        {recipients?.length ? <div className="card mt-5 overflow-x-auto rounded-2xl"><table className="min-w-full text-left text-sm"><thead className="border-b border-[#e6ece9] bg-[#f7faf8] text-xs font-semibold text-[#60716a]"><tr><th className="whitespace-nowrap px-5 py-3">Email</th>{columns.map((column) => <th key={column} className="whitespace-nowrap px-5 py-3">{column}</th>)}<th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#edf1ef]">{recipients.map((recipient) => <tr key={recipient.id}><td className="whitespace-nowrap px-5 py-3 font-medium">{recipient.email}</td>{columns.map((column) => <td key={column} className="max-w-60 truncate whitespace-nowrap px-5 py-3 text-[#53645f]" title={String(recipient.data?.[column] ?? "")}>{String(recipient.data?.[column] ?? "")}</td>)}<td className="px-5 py-3 text-[#53645f] capitalize">{(recipient.email_drafts?.[0]?.status ?? recipient.status).replaceAll("_", " ")}</td></tr>)}</tbody></table></div> : null}
        {recipientCount > PAGE_SIZE ? <nav aria-label="Recipient pages" className="mt-4 flex items-center justify-between text-sm"><span className="text-[#65736f]">Page {Math.min(page, totalPages)} of {totalPages}</span><div className="flex gap-2"><Link aria-disabled={page <= 1} className={`button-secondary ${page <= 1 ? "pointer-events-none opacity-50" : ""}`} href={`/campaigns/${id}?page=${page - 1}`}><ChevronLeft size={16} /> Previous</Link><Link aria-disabled={page >= totalPages} className={`button-secondary ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`} href={`/campaigns/${id}?page=${page + 1}`}>Next <ChevronRight size={16} /></Link></div></nav> : null}
      </section>
    </div>
  );
}

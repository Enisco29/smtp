import type { Metadata } from "next";
import { ArrowLeft, ChevronLeft, ChevronRight, MailCheck, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApproveAllDrafts } from "@/components/forms/approve-all-drafts";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { draftStatuses, recipientName, type DraftStatus } from "@/lib/drafts/workflow";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review drafts" };
const PAGE_SIZE = 25;

export default async function DraftsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const user = await requireOnboardedUser();
  const { id } = await params;
  const query = await searchParams;
  const q = (query.q ?? "").trim().toLocaleLowerCase();
  const status = draftStatuses.includes(query.status as DraftStatus) ? query.status as DraftStatus : "";
  const rawPage = Number(query.page ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const supabase = await createClient();
  const { data: campaign } = await supabase.from("campaigns")
    .select("id, name, status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!campaign) notFound();
  const [{ count: recipientCount }, { data: drafts, error }] = await Promise.all([
    supabase.from("recipients").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("email_drafts")
      .select("id, subject, status, content_state, content_revision, failure_code, updated_at, recipients(email, data)")
      .eq("campaign_id", id).order("updated_at", { ascending: false }).limit(5000),
  ]);
  if (error) throw new Error("Could not load campaign drafts.");
  const all = drafts ?? [];
  const filtered = all.filter((draft) => {
    const recipient = draft.recipients as unknown as { email?: string; data?: Record<string, unknown> } | null;
    const haystack = `${recipientName(recipient?.data)} ${recipient?.email ?? ""}`.toLocaleLowerCase();
    return (!status || draft.status === status) && (!q || haystack.includes(q));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const totals = await Promise.all(draftStatuses.map((value) => supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("campaign_id", id).eq("status", value)));
  if (totals.some((result) => result.error)) throw new Error("Could not load campaign draft totals.");
  const countStatus = (value: string) => totals[draftStatuses.indexOf(value as DraftStatus)]?.count ?? 0;
  const generated = countStatus("generated");
  const edited = countStatus("edited");
  const approved = countStatus("approved");
  const excluded = countStatus("excluded");
  const sent = countStatus("sent");
  const sendFailed = countStatus("send_failed");
  const uncertain = countStatus("uncertain");
  const activelySending = countStatus("sending");
  const pending = Math.max(0, (recipientCount ?? 0) - approved - excluded - sent - sendFailed - uncertain - activelySending);
  const eligible = generated + edited;
  const href = (next: number) => `/campaigns/${id}/drafts?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(next) })}`;

  return <div className="mx-auto max-w-6xl">
    <Link href={`/campaigns/${id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#53645f] hover:text-[#146c54]"><ArrowLeft size={16} /> {campaign.name}</Link>
    <div className="mt-7 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">Review drafts</h1><p className="mt-2 text-sm text-[#65736f]">Review, refine, approve, or exclude each recipient before sending.</p></div><div className="flex flex-wrap gap-3">{["draft", "sending"].includes(campaign.status) ? <ApproveAllDrafts campaignId={id} eligible={eligible} /> : null}{approved > 0 || campaign.status === "sending" ? <Link className="button-primary" href={`/campaigns/${id}/send`}><MailCheck size={17} /> Send Approved Emails</Link> : null}</div></div>
    <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {[["Recipients", recipientCount ?? 0], ["Generated", generated], ["Edited", edited], ["Generation failed", countStatus("failed")], ["Approved", approved], ["Sent", sent], ["Send failed", sendFailed], ["Uncertain", uncertain], ["Excluded", excluded], ["Awaiting approval", pending]].map(([label, value]) => <div key={label} className="card rounded-xl p-4"><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-[#65736f]">{label}</p></div>)}
    </div>
    <form className="card mt-7 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_220px_auto]" action={`/campaigns/${id}/drafts`}>
      <label className="relative"><span className="sr-only">Search drafts</span><Search className="pointer-events-none absolute left-3 top-3.5 text-[#71807b]" size={17} /><input className="field pl-10" name="q" defaultValue={query.q} placeholder="Search recipient name or email" /></label>
      <select name="status" defaultValue={status} className="field"><option value="">All statuses</option>{draftStatuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
      <button className="button-secondary">Filter</button>
    </form>
    {filtered.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-[#b9c9c3] bg-white/50 p-8 text-center text-sm text-[#65736f]">No drafts match these filters.</div> : <div className="card mt-5 overflow-x-auto rounded-2xl"><table className="min-w-full text-left text-sm"><thead className="border-b border-[#e6ece9] bg-[#f7faf8] text-xs font-semibold text-[#60716a]"><tr><th className="px-5 py-3">Recipient</th><th className="px-5 py-3">Subject</th><th className="px-5 py-3">Status</th><th className="px-5 py-3"><span className="sr-only">Open</span></th></tr></thead><tbody className="divide-y divide-[#edf1ef]">{visible.map((draft) => {
      const recipient = draft.recipients as unknown as { email?: string; data?: Record<string, unknown> } | null;
      const name = recipientName(recipient?.data);
      const attention = !["approved", "excluded", "sent"].includes(draft.status);
      return <tr key={draft.id} className={attention ? "bg-[#fffdf5]" : ""}><td className="px-5 py-3"><span className="font-medium">{name || recipient?.email}</span>{name ? <span className="block text-xs text-[#71807b]">{recipient?.email}</span> : null}</td><td className="max-w-80 truncate px-5 py-3 text-[#53645f]">{draft.subject ?? "—"}</td><td className="px-5 py-3"><span className="capitalize">{draft.status}</span>{attention ? <span className="block text-xs font-semibold text-[#9a6700]">Needs attention</span> : null}</td><td className="px-5 py-3 text-right"><Link className="font-semibold text-[#146c54] hover:underline" href={`/campaigns/${id}/drafts/${draft.id}`}>Review</Link></td></tr>;
    })}</tbody></table></div>}
    {filtered.length > PAGE_SIZE ? <nav className="mt-4 flex items-center justify-between text-sm"><span className="text-[#65736f]">Page {currentPage} of {totalPages}</span><div className="flex gap-2"><Link aria-disabled={currentPage <= 1} className={`button-secondary ${currentPage <= 1 ? "pointer-events-none opacity-50" : ""}`} href={href(currentPage - 1)}><ChevronLeft size={16} /> Previous</Link><Link aria-disabled={currentPage >= totalPages} className={`button-secondary ${currentPage >= totalPages ? "pointer-events-none opacity-50" : ""}`} href={href(currentPage + 1)}>Next <ChevronRight size={16} /></Link></div></nav> : null}
  </div>;
}

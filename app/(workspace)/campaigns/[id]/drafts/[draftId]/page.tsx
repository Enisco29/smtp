import type { Metadata } from "next";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftReviewControls } from "@/components/forms/draft-review";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { recipientName } from "@/lib/drafts/workflow";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review email draft" };

export default async function DraftPage({ params }: { params: Promise<{ id: string; draftId: string }> }) {
  const user = await requireOnboardedUser();
  const { id, draftId } = await params;
  const supabase = await createClient();
  const { data: campaign } = await supabase.from("campaigns").select("id, name, status")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!campaign) notFound();
  const [{ data: draft }, { data: neighbors }] = await Promise.all([
    supabase.from("email_drafts").select("id, subject, body, status, content_state, content_revision, failure_code, updated_at, recipients(email, data)").eq("id", draftId).eq("campaign_id", id).maybeSingle(),
    supabase.from("email_drafts").select("id").eq("campaign_id", id).order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(5000),
  ]);
  if (!draft) notFound();
  const ids = (neighbors ?? []).map((item) => item.id);
  const index = ids.indexOf(draftId);
  const previous = index > 0 ? ids[index - 1] : null;
  const next = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;
  const recipient = draft.recipients as unknown as { email: string; data: Record<string, unknown> };
  const name = recipientName(recipient.data);

  return <div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href={`/campaigns/${id}/drafts`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#53645f] hover:text-[#146c54]"><ArrowLeft size={16} /> All drafts</Link><nav className="flex gap-2"><Link aria-disabled={!previous} className={`button-secondary ${!previous ? "pointer-events-none opacity-50" : ""}`} href={previous ? `/campaigns/${id}/drafts/${previous}` : "#"}><ChevronLeft size={16} /> Previous</Link><Link aria-disabled={!next} className={`button-secondary ${!next ? "pointer-events-none opacity-50" : ""}`} href={next ? `/campaigns/${id}/drafts/${next}` : "#"}>Next <ChevronRight size={16} /></Link></nav></div>
    <div className="mt-7"><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold tracking-[-.04em]">{name || recipient.email}</h1><span className="rounded-full bg-[#eef7f3] px-3 py-1 text-xs font-bold capitalize text-[#146c54]">{draft.status}</span></div>{name ? <p className="mt-2 text-sm text-[#65736f]">{recipient.email}</p> : null}</div>
    <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div>{draft.subject && draft.body ? <DraftReviewControls key={`${draft.id}:${draft.content_revision}:${draft.status}`} readOnly={!["draft", "sending"].includes(campaign.status)} campaignId={id} draftId={draft.id} subject={draft.subject} body={draft.body} status={draft.status} revision={draft.content_revision} /> : <div className="card rounded-2xl p-6"><h2 className="font-bold">Draft unavailable</h2><p className="mt-2 text-sm text-[#65736f]">This draft is {draft.status}. Return to the campaign to retry generation.</p>{draft.failure_code ? <p className="mt-2 text-sm text-[#b42318]">{draft.failure_code.replaceAll("_", " ")}</p> : null}</div>}</div>
      <aside className="card h-fit rounded-2xl p-5"><h2 className="font-bold">Recipient information</h2><dl className="mt-4 space-y-3"><div><dt className="text-xs font-semibold uppercase tracking-wide text-[#71807b]">Email</dt><dd className="mt-1 break-all text-sm">{recipient.email}</dd></div>{Object.entries(recipient.data ?? {}).map(([key, value]) => <div key={key}><dt className="text-xs font-semibold uppercase tracking-wide text-[#71807b]">{key.replaceAll("_", " ")}</dt><dd className="mt-1 break-words text-sm text-[#53645f]">{String(value ?? "") || "—"}</dd></div>)}</dl></aside>
    </div>
  </div>;
}

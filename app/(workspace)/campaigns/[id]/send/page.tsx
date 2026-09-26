import type { Metadata } from "next";
import { ArrowLeft, ChevronLeft, ChevronRight, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignSendingControls, RetrySendButton } from "@/components/forms/campaign-sending";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { recipientName } from "@/lib/drafts/workflow";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Send campaign" };
const PAGE_SIZE = 25;

export default async function SendCampaignPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireOnboardedUser();
  const { id } = await params;
  const rawPage = Number((await searchParams).page ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const supabase = await createClient();
  let { data: campaign } = await supabase.from("campaigns").select("id, name, status")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!campaign) notFound();
  if (campaign.status === "sending") {
    await supabase.rpc("refresh_campaign_send_state", { p_campaign_id: id });
    const latest = await supabase.from("campaigns").select("id, name, status").eq("id", id).eq("user_id", user.id).maybeSingle();
    campaign = latest.data ?? campaign;
  }
  const [{ data: frozenSender }, { data: account }, { data: drafts, count }, { count: recipients }] = await Promise.all([
    supabase.from("campaign_senders").select("sender_name, sender_email, credential_status").eq("campaign_id", id).maybeSingle(),
    supabase.from("smtp_accounts").select("sender_name, sender_email").eq("user_id", user.id).maybeSingle(),
    supabase.from("email_drafts").select("id, subject, status, send_attempt_count, send_retryable, send_error_message, sent_at, recipients(email, data)", { count: "exact" })
      .eq("campaign_id", id).order("updated_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from("recipients").select("id", { count: "exact", head: true }).eq("campaign_id", id),
  ]);
  const sender = frozenSender ?? account;
  if (!sender) notFound();
  const allCounts = await Promise.all(["approved", "sending", "sent", "send_failed", "uncertain", "excluded"].map((status) => supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("campaign_id", id).eq("status", status)));
  const [approved, sending, sent, failed, uncertain, excluded] = allCounts.map((result) => result.count ?? 0);
  const { count: retryable } = await supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "send_failed").eq("send_retryable", true);
  const queued = approved + sending + sent + failed + uncertain;
  const awaiting = Math.max(0, (recipients ?? 0) - queued - excluded);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const active = ["draft", "sending"].includes(campaign.status);

  return <div className="mx-auto max-w-6xl">
    <Link href={`/campaigns/${id}/drafts`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#53645f] hover:text-[#146c54]"><ArrowLeft size={16} /> Review drafts</Link>
    <div className="mt-7"><p className="text-sm font-semibold text-[#146c54]">Campaign sending</p><h1 className="mt-2 text-3xl font-bold tracking-[-.04em] sm:text-4xl">{campaign.name}</h1><p className="mt-3 max-w-2xl text-[#65736f]">Confirm and send approved emails in controlled, individually recorded batches.</p></div>
    <section className="card mt-7 rounded-2xl p-6"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e5f3ed] text-[#146c54]"><LockKeyhole size={19} /></span><div><h2 className="font-bold">{frozenSender ? "Frozen campaign sender" : "Sender to be frozen on confirmation"}</h2><p className="mt-1 text-sm text-[#53645f]">{sender.sender_name ? `${sender.sender_name} · ` : ""}{sender.sender_email}</p><p className="mt-1 text-xs text-[#71807b]">The sender address cannot change after sending starts.</p></div></div>
      <p className="mt-5 text-sm text-[#53645f]">{approved} approved emails ready · {excluded} excluded recipients · {awaiting} drafts awaiting approval</p>
      <div className="mt-6"><CampaignSendingControls senderEmail={sender.sender_email} campaignId={id} campaignStatus={campaign.status} initial={{ total: queued, sent, pending: approved + sending, failed, uncertain, excluded, retryable: retryable ?? 0 }} credentialInvalid={frozenSender?.credential_status === "invalid"} finishSummary={`${approved} approved, ${awaiting} awaiting approval, ${failed} failed, and ${uncertain} uncertain emails remain.`} /></div>
    </section>
    <section className="mt-9"><div><h2 className="text-xl font-bold">Recipient delivery log</h2><Link className="mt-2 inline-block text-sm font-semibold text-[#146c54]" href={`/campaigns/${id}/send/history`}>View all sending attempts</Link><p className="mt-1 text-sm text-[#65736f]">{awaiting} draft{awaiting === 1 ? "" : "s"} still await approval or generation.</p></div>
      {drafts?.length ? <div className="card mt-5 overflow-x-auto rounded-2xl"><table className="min-w-full text-left text-sm"><thead className="border-b border-[#e6ece9] bg-[#f7faf8] text-xs font-semibold text-[#60716a]"><tr><th className="px-5 py-3">Recipient</th><th className="px-5 py-3">Subject</th><th className="px-5 py-3">Delivery</th><th className="px-5 py-3">Sent</th><th className="px-5 py-3">Attempts</th><th className="px-5 py-3"></th></tr></thead><tbody className="divide-y divide-[#edf1ef]">{drafts.map((draft) => {
        const recipient = draft.recipients as unknown as { email: string; data: Record<string, unknown> };
        const name = recipientName(recipient.data);
        return <tr key={draft.id}><td className="px-5 py-3"><span className="font-medium">{name || recipient.email}</span>{name ? <span className="block text-xs text-[#71807b]">{recipient.email}</span> : null}</td><td className="max-w-72 truncate px-5 py-3 text-[#53645f]">{draft.subject ?? "—"}</td><td className="px-5 py-3"><span className="capitalize">{draft.status.replaceAll("_", " ")}</span>{draft.send_error_message ? <span className="mt-1 block max-w-72 text-xs text-[#b42318]">{draft.send_error_message}</span> : null}</td><td className="whitespace-nowrap px-5 py-3 text-[#53645f]">{draft.sent_at ? new Date(draft.sent_at).toLocaleString() : "—"}</td><td className="px-5 py-3 text-[#53645f]">{draft.send_attempt_count}</td><td className="px-5 py-3">{active && draft.status === "send_failed" && draft.send_retryable ? <RetrySendButton senderEmail={sender.sender_email} campaignId={id} draftId={draft.id} disabled={frozenSender?.credential_status === "invalid"} /> : null}</td></tr>;
      })}</tbody></table></div> : <div className="mt-5 rounded-2xl border border-dashed border-[#b9c9c3] p-8 text-center text-sm text-[#65736f]">No draft delivery records yet.</div>}
      {(count ?? 0) > PAGE_SIZE ? <nav className="mt-4 flex items-center justify-between text-sm"><span className="text-[#65736f]">Page {page} of {totalPages}</span><div className="flex gap-2"><Link className={`button-secondary ${page <= 1 ? "pointer-events-none opacity-50" : ""}`} href={`/campaigns/${id}/send?page=${page - 1}`}><ChevronLeft size={16} /> Previous</Link><Link className={`button-secondary ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`} href={`/campaigns/${id}/send?page=${page + 1}`}>Next <ChevronRight size={16} /></Link></div></nav> : null}
    </section>
  </div>;
}

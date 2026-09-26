import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export default async function SendingHistory({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireOnboardedUser();
  const { id } = await params;
  const value = Number((await searchParams).page ?? "1");
  const page = Number.isSafeInteger(value) && value > 0 ? value : 1;
  const supabase = await createClient();
  const { data: campaign } = await supabase.from("campaigns").select("name").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!campaign) notFound();
  const { data: events, count, error } = await supabase.from("email_send_events")
    .select("id, attempt_number, status, error_message, started_at, finished_at, email_drafts(subject, recipients(email))", { count: "exact" })
    .eq("campaign_id", id).order("started_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * 25, page * 25 - 1);
  return <div className="mx-auto max-w-6xl">
    <Link className="text-sm font-semibold text-[#146c54]" href={`/campaigns/${id}/send`}>← Campaign delivery</Link>
    <h1 className="mt-7 text-3xl font-bold tracking-[-.04em]">Sending history</h1>
    <p className="mt-2 text-sm text-[#65736f]">Every recorded delivery attempt for {campaign.name}.</p>
    {error ? <p role="alert" className="mt-5 text-[#b42318]">Sending history could not be loaded.</p> : null}
    <div className="card mt-6 overflow-x-auto rounded-2xl"><table className="min-w-full text-left text-sm"><thead className="bg-[#f7faf8]"><tr>{["Recipient", "Subject", "Attempt", "Result", "Started", "Finished"].map((label) => <th key={label} className="px-5 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-[#edf1ef]">{events?.map((event) => {
      const draft = event.email_drafts as unknown as { subject: string; recipients: { email: string } };
      return <tr key={event.id}><td className="px-5 py-3">{draft?.recipients?.email}</td><td className="max-w-64 truncate px-5 py-3">{draft?.subject}</td><td className="px-5 py-3">{event.attempt_number}</td><td className="px-5 py-3"><span className="capitalize">{event.status.replaceAll("_", " ")}</span>{event.error_message ? <p className="mt-1 max-w-72 text-xs text-[#b42318]">{event.error_message}</p> : null}</td><td className="whitespace-nowrap px-5 py-3">{new Date(event.started_at).toLocaleString()}</td><td className="whitespace-nowrap px-5 py-3">{event.finished_at ? new Date(event.finished_at).toLocaleString() : "—"}</td></tr>;
    })}</tbody></table></div>
    {!count && !error ? <p className="mt-4 text-sm text-[#65736f]">No sending attempts yet.</p> : null}
    <nav className="mt-4 flex justify-between"><Link aria-disabled={page <= 1} className={`button-secondary ${page <= 1 ? "pointer-events-none opacity-50" : ""}`} href={`/campaigns/${id}/send/history?page=${page - 1}`}>Previous</Link><Link aria-disabled={page * 25 >= (count ?? 0)} className={`button-secondary ${page * 25 >= (count ?? 0) ? "pointer-events-none opacity-50" : ""}`} href={`/campaigns/${id}/send/history?page=${page + 1}`}>Next</Link></nav>
  </div>;
}

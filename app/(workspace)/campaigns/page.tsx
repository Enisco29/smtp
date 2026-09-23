import type { Metadata } from "next";
import { ArrowRight, FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const user = await requireOnboardedUser();
  const supabase = await createClient();
  const { data: campaigns, error } = await supabase.from("campaigns")
    .select("id, name, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-semibold text-[#146c54]">Workspace</p><h1 className="mt-2 text-3xl font-bold tracking-[-.04em] sm:text-4xl">Campaigns</h1><p className="mt-3 text-[#65736f]">Create a campaign and prepare its recipient list.</p></div>
        <Link href="/campaigns/new" className="button-primary"><Plus size={17} /> New Campaign</Link>
      </div>
      {error ? <p role="alert" className="mt-8 text-sm text-[#b42318]">Could not load campaigns. Please refresh the page.</p> : null}
      {!error && campaigns?.length === 0 ? (
        <div className="card mt-9 rounded-[24px] p-8 text-center sm:p-12">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#e5f3ed] text-[#146c54]"><FolderOpen size={23} /></span>
          <h2 className="mt-5 text-xl font-bold tracking-[-.03em]">No campaigns yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#65736f]">Start with your objective. You can upload, check, and correct a CSV recipient list after creating the campaign.</p>
          <Link href="/campaigns/new" className="button-primary mt-6"><Plus size={17} /> New Campaign</Link>
        </div>
      ) : null}
      {campaigns?.length ? <div className="mt-9 grid gap-3">
        {campaigns.map((campaign) => <Link key={campaign.id} href={`/campaigns/${campaign.id}`} className="card flex items-center justify-between gap-4 rounded-2xl p-5 transition hover:border-[#aacfc0] hover:shadow-md">
          <div className="min-w-0"><h2 className="truncate font-bold">{campaign.name}</h2><p className="mt-1 text-xs text-[#71807b]">Created {new Date(campaign.created_at).toLocaleDateString()}</p></div>
          <div className="flex shrink-0 items-center gap-3"><span className="rounded-full bg-[#eef7f3] px-2.5 py-1 text-xs font-bold capitalize text-[#146c54]">{campaign.status}</span><ArrowRight size={18} className="text-[#71807b]" /></div>
        </Link>)}
      </div> : null}
    </div>
  );
}

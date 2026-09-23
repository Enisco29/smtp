import type { Metadata } from "next";
import { ArrowRight, CheckCircle2, FolderOpen, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const supabase = await createClient();
  const [{ data: profile }, { data: smtp }] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).maybeSingle(),
    supabase.from("smtp_accounts").select("sender_email").eq("user_id", user.id).maybeSingle(),
  ]);
  const firstName = profile?.name?.split(" ")[0];
  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-sm font-semibold text-[#146c54]">Workspace</p>
      <h1 className="mt-2 text-3xl font-bold tracking-[-.04em] sm:text-4xl">{firstName ? `Welcome, ${firstName}` : "Your workspace is ready"}</h1>
      <p className="mt-3 max-w-2xl leading-7 text-[#65736f]">Your sending connection is ready. Create a campaign and prepare its recipient list.</p>
      <section className="mt-9 grid gap-4 sm:grid-cols-2">
        <div className="card rounded-2xl p-6"><div className="flex items-center justify-between"><span className="grid size-11 place-items-center rounded-xl bg-[#e5f3ed] text-[#146c54]"><ShieldCheck size={22} /></span><span className="inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf3] px-2.5 py-1 text-xs font-bold text-[#067647]"><CheckCircle2 size={13} /> Connected</span></div><h2 className="mt-5 font-bold">Gmail sender</h2><p className="mt-1 text-sm text-[#65736f]">{smtp?.sender_email ?? "Configured"}</p><Link href="/settings" className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-[#146c54]">Manage sender <ArrowRight size={15} /></Link></div>
        <div className="card rounded-2xl p-6"><span className="grid size-11 place-items-center rounded-xl bg-[#e5f3ed] text-[#146c54]"><FolderOpen size={22} /></span><h2 className="mt-5 font-bold">Campaigns</h2><p className="mt-1 text-sm leading-6 text-[#65736f]">Create an outreach objective, then upload and review a CSV recipient list.</p><div className="mt-5 flex flex-wrap gap-3"><Link href="/campaigns/new" className="button-primary"><Plus size={16} /> New Campaign</Link><Link href="/campaigns" className="button-secondary">View campaigns <ArrowRight size={15} /></Link></div></div>
      </section>
    </div>
  );
}

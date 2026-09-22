import type { Metadata } from "next";
import { ArrowRight, CheckCircle2, MailPlus, ShieldCheck } from "lucide-react";
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
      <p className="mt-3 max-w-2xl leading-7 text-[#65736f]">Your sending connection is secure and ready. Campaign creation arrives in the next phase.</p>
      <section className="mt-9 grid gap-4 sm:grid-cols-2">
        <div className="card rounded-2xl p-6"><div className="flex items-center justify-between"><span className="grid size-11 place-items-center rounded-xl bg-[#e5f3ed] text-[#146c54]"><ShieldCheck size={22} /></span><span className="inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf3] px-2.5 py-1 text-xs font-bold text-[#067647]"><CheckCircle2 size={13} /> Connected</span></div><h2 className="mt-5 font-bold">Gmail sender</h2><p className="mt-1 text-sm text-[#65736f]">{smtp?.sender_email ?? "Configured"}</p><Link href="/settings" className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-[#146c54]">Manage sender <ArrowRight size={15} /></Link></div>
        <div className="rounded-2xl border border-dashed border-[#b9c9c3] bg-white/50 p-6"><span className="grid size-11 place-items-center rounded-xl bg-[#f0f3f2] text-[#62716c]"><MailPlus size={22} /></span><h2 className="mt-5 font-bold">Campaigns are coming next</h2><p className="mt-1 text-sm leading-6 text-[#65736f]">Upload recipients, generate tailored drafts, review, and send—all in the next build phase.</p></div>
      </section>
    </div>
  );
}

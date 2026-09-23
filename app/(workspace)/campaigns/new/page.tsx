import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { CreateCampaignForm } from "@/components/forms/create-campaign-form";

export const metadata: Metadata = { title: "New Campaign" };

export default function NewCampaignPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm font-semibold text-[#53645f] hover:text-[#146c54]"><ArrowLeft size={16} /> Campaigns</Link>
      <p className="mt-8 text-sm font-semibold text-[#146c54]">New campaign</p>
      <h1 className="mt-2 text-3xl font-bold tracking-[-.04em]">Describe your outreach</h1>
      <p className="mt-3 leading-7 text-[#65736f]">Give this campaign a name and describe the email you want to create. You’ll add recipients next.</p>
      <div className="mt-8"><CreateCampaignForm /></div>
    </div>
  );
}

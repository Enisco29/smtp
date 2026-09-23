import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { OnboardingForm } from "@/components/forms/onboarding-form";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your sender" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("id", user.id)
    .maybeSingle();
  if (data?.onboarding_completed_at) redirect("/dashboard");
  return (
    <main className="min-h-screen px-5 py-6 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-6xl">
        <Brand />
        <div className="mx-auto max-w-2xl py-12 sm:py-16">
          <div className="mb-8">
            <p className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-[#146c54]">
              Sender setup · 1 of 1
            </p>
            <h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">
              Connect your sending account
            </h1>
            <p className="mt-3 max-w-xl leading-7 text-[#65736f]">
              We’ll verify your Gmail connection before opening your workspace.
              Your credential is encrypted before it is stored.
            </p>
          </div>
          <OnboardingForm defaultEmail={user.email ?? ""} />
        </div>
      </div>
    </main>
  );
}

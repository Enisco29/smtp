import type { Metadata } from "next";
import { AiProviderSettings } from "@/components/forms/ai-provider-settings";
import { SettingsForm } from "@/components/forms/settings-form";
import { isAiProvider, type AiProvider } from "@/lib/ai/providers";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireOnboardedUser();
  const supabase = await createClient();
  const { data } = await supabase.from("smtp_accounts").select("sender_name, sender_email").eq("user_id", user.id).single();
  const { data: profile } = await supabase.from("profiles").select("active_ai_provider").eq("id", user.id).single();
  const { data: keyMetadata } = await supabase.from("ai_provider_keys").select("provider").eq("user_id", user.id);
  const configured = (keyMetadata ?? []).map((item) => item.provider).filter(isAiProvider) as AiProvider[];
  const active = isAiProvider(profile?.active_ai_provider) ? profile.active_ai_provider : null;
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-semibold text-[#146c54]">Account</p><h1 className="mt-2 text-3xl font-bold tracking-[-.04em]">Sender settings</h1><p className="mt-3 leading-7 text-[#65736f]">Update the identity and Gmail account used for outgoing messages.</p>
      <div className="mt-8"><SettingsForm senderName={data?.sender_name ?? ""} senderEmail={data?.sender_email ?? ""} /></div>
      <AiProviderSettings configured={configured} active={active} />
    </div>
  );
}

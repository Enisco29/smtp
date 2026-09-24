"use client";

import { useActionState } from "react";
import { updateAiProviderAction } from "@/lib/actions/ai-settings";
import { initialActionState } from "@/lib/actions/state";
import { AI_PROVIDERS, AI_PROVIDER_LABELS, type AiProvider } from "@/lib/ai/providers";
import { FormStatus } from "@/components/form-status";

function ProviderRow({ provider, configured, active }: { provider: AiProvider; configured: boolean; active: boolean }) {
  const [state, action, pending] = useActionState(updateAiProviderAction, initialActionState);
  return <div className="rounded-xl border border-[#e6ece9] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-semibold">{AI_PROVIDER_LABELS[provider]}</h3><p className="text-xs text-[#71807b]">{configured ? "Key saved" : "No key saved"}{active ? " · Active provider" : ""}</p></div>
      {configured ? <div className="flex gap-2">
        {!active ? <form action={action}><input type="hidden" name="provider" value={provider} /><input type="hidden" name="operation" value="select" /><button disabled={pending} className="button-secondary" type="submit">Use provider</button></form> : null}
        <form action={action} onSubmit={(event) => { if (!window.confirm(`Remove your ${AI_PROVIDER_LABELS[provider]} key?`)) event.preventDefault(); }}><input type="hidden" name="provider" value={provider} /><input type="hidden" name="operation" value="remove" /><button disabled={pending} className="button-secondary text-[#b42318]" type="submit">Remove key</button></form>
      </div> : null}
    </div>
    <form action={action} className="mt-3 flex flex-col gap-2 sm:flex-row"><input type="hidden" name="provider" value={provider} /><input type="hidden" name="operation" value="save" /><input className="field min-w-0 flex-1" aria-label={`${AI_PROVIDER_LABELS[provider]} API key`} name="apiKey" type="password" autoComplete="new-password" maxLength={1000} placeholder={configured ? "Enter a new key to replace the saved key" : "Enter API key"} required /><button disabled={pending} className="button-primary shrink-0" type="submit">{configured ? "Replace key" : "Save key"}</button></form>
    <div className="mt-2"><FormStatus state={state} /></div>
  </div>;
}

export function AiProviderSettings({ configured, active }: { configured: AiProvider[]; active: AiProvider | null }) {
  return <section className="mt-9"><h2 className="text-xl font-bold tracking-[-.03em]">AI draft provider</h2><p className="mt-2 text-sm leading-6 text-[#65736f]">Save keys for multiple providers, then choose one for new draft generation. Existing keys remain saved when you switch. Keys are encrypted and never displayed.</p><div className="card mt-4 space-y-3 rounded-[24px] p-5 sm:p-7">{AI_PROVIDERS.map((provider) => <ProviderRow key={provider} provider={provider} configured={configured.includes(provider)} active={active === provider} />)}</div></section>;
}

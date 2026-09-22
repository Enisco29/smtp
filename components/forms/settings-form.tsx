"use client";

import { Info, LockKeyhole } from "lucide-react";
import { useActionState } from "react";
import { FormStatus } from "@/components/form-status";
import { SubmitButton } from "@/components/submit-button";
import { updateSettingsAction } from "@/lib/actions/settings";
import { initialActionState } from "@/lib/actions/state";

export function SettingsForm({ senderName, senderEmail }: { senderName: string; senderEmail: string }) {
  const [state, action] = useActionState(updateSettingsAction, initialActionState);
  return (
    <form action={action} className="card rounded-[24px] p-6 sm:p-8">
      <div className="space-y-5">
        <FormStatus state={state} />
        <div><label className="label" htmlFor="senderName">Sender name <span className="font-normal text-[#71807b]">(optional)</span></label><input className="field" id="senderName" name="senderName" defaultValue={senderName} maxLength={100} placeholder="Alex at Acme" /></div>
        <div><label className="label" htmlFor="senderEmail">Gmail or Google Workspace email</label><input className="field" id="senderEmail" name="senderEmail" type="email" required defaultValue={senderEmail} /></div>
        <div><label className="label" htmlFor="appPassword">New Google App Password <span className="font-normal text-[#71807b]">(optional)</span></label><input className="field" id="appPassword" name="appPassword" type="password" autoComplete="new-password" placeholder="Leave blank to keep the existing password" /><p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#71807b]"><LockKeyhole size={13} /> Stored credentials are never displayed or returned.</p></div>
        <div className="flex gap-3 rounded-xl bg-[#f3f6f5] p-3.5 text-xs leading-5 text-[#5b6965]"><Info className="mt-0.5 shrink-0" size={16} /><p>Changing the email or App Password triggers a new Gmail verification. Nothing is saved unless verification succeeds.</p></div>
        <SubmitButton pendingLabel="Saving securely…">Save settings</SubmitButton>
      </div>
    </form>
  );
}

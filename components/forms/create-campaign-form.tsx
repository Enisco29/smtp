"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/form-status";
import { SubmitButton } from "@/components/submit-button";
import { createCampaignAction } from "@/lib/actions/campaigns";
import { initialActionState } from "@/lib/actions/state";

export function CreateCampaignForm() {
  const [state, action] = useActionState(createCampaignAction, initialActionState);
  return (
    <form action={action} className="card space-y-6 rounded-[24px] p-6 sm:p-8">
      <FormStatus state={state} />
      <div><label className="label" htmlFor="name">Campaign name</label><input className="field" id="name" name="name" required maxLength={120} placeholder="September product outreach" /></div>
      <div><label className="label" htmlFor="instructions">Email instructions and objective</label><textarea className="field min-h-40 resize-y" id="instructions" name="instructions" required placeholder="Describe who you are contacting, why, your desired tone, and the action you want recipients to take." /><p className="mt-2 text-xs leading-5 text-[#71807b]">These instructions will be used for draft generation in a later phase.</p></div>
      <SubmitButton pendingLabel="Creating campaign…">Create campaign</SubmitButton>
    </form>
  );
}

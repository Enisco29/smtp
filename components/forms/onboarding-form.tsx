"use client";

import { KeyRound, LockKeyhole } from "lucide-react";
import { useActionState } from "react";
import { FormStatus } from "@/components/form-status";
import { SubmitButton } from "@/components/submit-button";
import { completeOnboardingAction } from "@/lib/actions/onboarding";
import { initialActionState } from "@/lib/actions/state";

export function OnboardingForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, action] = useActionState(
    completeOnboardingAction,
    initialActionState,
  );
  return (
    <form action={action} className="card rounded-[24px] p-6 sm:p-8">
      <div className="mb-6 flex gap-3 rounded-2xl bg-[#eef7f3] p-4 text-sm leading-6 text-[#31554a]">
        <KeyRound className="mt-0.5 shrink-0 text-[#146c54]" size={20} />
        <p>
          <strong className="text-[#183e33]">Use a Google App Password.</strong>{" "}
          Your normal Gmail password will not work. Google Workspace
          administrators can disable App Passwords for their organization.
        </p>
      </div>
      <div className="space-y-5">
        <FormStatus state={state} />
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">
              Your name{" "}
              <span className="font-normal text-[#71807b]">(optional)</span>
            </label>
            <input
              className="field"
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Alex Morgan"
              maxLength={100}
            />
          </div>
          <div>
            <label className="label" htmlFor="senderName">
              Sender name{" "}
              <span className="font-normal text-[#71807b]">(optional)</span>
            </label>
            <input
              className="field"
              id="senderName"
              name="senderName"
              placeholder="Alex at Acme"
              maxLength={100}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="senderEmail">
            Gmail or Google Workspace email
          </label>
          <input
            className="field"
            id="senderEmail"
            name="senderEmail"
            type="email"
            autoComplete="email"
            required
            defaultValue={defaultEmail}
            placeholder="alex@company.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="appPassword">
            Google App Password
          </label>
          <input
            className="field"
            id="appPassword"
            name="appPassword"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Paste your App Password"
          />
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#71807b]">
            <LockKeyhole size={13} /> Spaces are removed automatically. The
            password is never returned to your browser.
          </p>
        </div>
        <SubmitButton pendingLabel="Verifying with Google…">
          Verify and finish setup
        </SubmitButton>
      </div>
    </form>
  );
}

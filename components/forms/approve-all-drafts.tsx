"use client";

import { CheckCheck } from "lucide-react";
import { useActionState } from "react";
import { approveAllDraftsAction } from "@/lib/actions/drafts";
import { initialActionState } from "@/lib/actions/state";
import { FormStatus } from "@/components/form-status";

export function ApproveAllDrafts({ campaignId, eligible }: { campaignId: string; eligible: number }) {
  const [state, action, pending] = useActionState(approveAllDraftsAction.bind(null, campaignId), initialActionState);
  return <div>
    <form action={action} onSubmit={(event) => {
      if (!window.confirm(`Approve all ${eligible} eligible drafts?`)) event.preventDefault();
    }}>
      <button className="button-primary" disabled={pending || eligible === 0}>
        <CheckCheck size={17} /> {pending ? "Approving…" : "Approve All"}
      </button>
    </form>
    {state.message ? <div className="mt-3"><FormStatus state={state} /></div> : null}
  </div>;
}

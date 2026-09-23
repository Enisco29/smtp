"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";
import { deleteCampaignAction } from "@/lib/actions/campaigns";
import { initialActionState } from "@/lib/actions/state";

export function DeleteCampaignForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteCampaignAction.bind(null, id), initialActionState);
  return (
    <form action={action} onSubmit={(event) => {
      if (!window.confirm("Delete this campaign and all its recipients? This cannot be undone.")) event.preventDefault();
    }}>
      <button type="submit" disabled={pending} className="button-secondary gap-2 text-[#b42318]"><Trash2 size={16} /> {pending ? "Deleting…" : "Delete campaign"}</button>
      {state.message && <p role="alert" className="mt-2 text-sm text-[#b42318]">{state.message}</p>}
    </form>
  );
}

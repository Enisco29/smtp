"use client";

import { Check, LoaderCircle, RotateCcw, Sparkles, Undo2, UserMinus } from "lucide-react";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  approveDraftAction, editDraftAction, excludeDraftAction, restoreDraftAction,
} from "@/lib/actions/drafts";
import { initialActionState } from "@/lib/actions/state";
import { FormStatus } from "@/components/form-status";

type Props = {
  campaignId: string;
  draftId: string;
  subject: string;
  body: string;
  status: string;
  revision: number;
};

type Preview = {
  original: { subject: string; body: string };
  proposed: { subject: string; body: string };
  baseRevision: number;
};

export function DraftReviewControls(props: Props) {
  const router = useRouter();
  const edit = editDraftAction.bind(null, props.campaignId, props.draftId);
  const approve = approveDraftAction.bind(null, props.campaignId, props.draftId, props.revision);
  const exclude = excludeDraftAction.bind(null, props.campaignId, props.draftId, props.revision);
  const restore = restoreDraftAction.bind(null, props.campaignId, props.draftId, props.revision);
  const [editState, editAction, editing] = useActionState(edit, initialActionState);
  const [approveState, approveAction, approving] = useActionState(approve, initialActionState);
  const [excludeState, excludeAction, excluding] = useActionState(exclude, initialActionState);
  const [restoreState, restoreAction, restoring] = useActionState(restore, initialActionState);
  const [previewState, acceptAction, accepting] = useActionState(edit, initialActionState);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<"regenerate" | "refine" | null>(null);
  const [aiError, setAiError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  async function aiRequest(mode: "regenerate" | "refine") {
    setBusy(mode); setAiError("");
    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}/drafts/${props.draftId}/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: props.revision, instructions }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "The AI request failed.");
      if (mode === "refine") setPreview(result as Preview);
      else router.refresh();
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "The AI request failed.");
    } finally { setBusy(null); }
  }

  const canReview = ["generated", "edited", "approved"].includes(props.status);
  return <div className="space-y-6">
    {props.status === "excluded" ? <div className="card rounded-2xl p-5">
      <p className="text-sm text-[#65736f]">This recipient is excluded from future sending. Restoring keeps the content but requires approval again.</p>
      <form action={restoreAction} className="mt-4"><button className="button-primary" disabled={restoring}><Undo2 size={17} /> {restoring ? "Restoring…" : "Restore recipient"}</button></form>
      {restoreState.message ? <div className="mt-3"><FormStatus state={restoreState} /></div> : null}
    </div> : null}

    {canReview ? <>
      <form action={editAction} className="card rounded-2xl p-5 sm:p-6">
        <h2 className="text-lg font-bold">Edit draft</h2>
        <input type="hidden" name="revision" value={props.revision} />
        <label className="mt-4 block text-sm font-semibold" htmlFor="subject">Subject</label>
        <input id="subject" name="subject" defaultValue={props.subject} maxLength={300} required className="field mt-2 w-full" />
        <label className="mt-4 block text-sm font-semibold" htmlFor="body">Email body</label>
        <textarea id="body" name="body" defaultValue={props.body} maxLength={20000} required rows={14} className="field mt-2 w-full resize-y" />
        <div className="mt-4 flex flex-wrap gap-3"><button className="button-primary" disabled={editing}>{editing ? "Saving…" : "Save changes"}</button></div>
        {editState.message ? <div className="mt-4"><FormStatus state={editState} /></div> : null}
      </form>

      <section className="card rounded-2xl p-5 sm:p-6">
        <h2 className="text-lg font-bold">AI revision</h2>
        <p className="mt-1 text-sm text-[#65736f]">Optionally describe the change. Regeneration saves immediately; refinement shows a preview first.</p>
        <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={1000} rows={3} className="field mt-4 w-full resize-y" placeholder="Make this shorter and more conversational." />
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className="button-secondary" disabled={busy !== null} onClick={() => aiRequest("regenerate")}>
            {busy === "regenerate" ? <LoaderCircle size={17} className="animate-spin" /> : <RotateCcw size={17} />} Regenerate
          </button>
          <button type="button" className="button-secondary" disabled={busy !== null || !instructions.trim()} onClick={() => aiRequest("refine")}>
            {busy === "refine" ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />} Preview refinement
          </button>
        </div>
        {aiError ? <p role="alert" className="mt-4 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-3.5 py-3 text-sm text-[#b42318]">{aiError}</p> : null}
      </section>

      {preview ? <section className="card rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Refinement preview</h2><p className="mt-1 text-sm text-[#65736f]">Compare before replacing the saved draft.</p></div><button type="button" className="button-secondary" onClick={() => setPreview(null)}>Discard</button></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {[{ label: "Original", value: preview.original }, { label: "Proposed", value: preview.proposed }].map(({ label, value }) => <div key={label} className="rounded-xl border border-[#dfe8e4] bg-[#f8faf9] p-4"><p className="text-xs font-bold uppercase tracking-wide text-[#65736f]">{label}</p><p className="mt-3 font-semibold">{value.subject}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#53645f]">{value.body}</p></div>)}
        </div>
        <form action={acceptAction} className="mt-4">
          <input type="hidden" name="revision" value={preview.baseRevision} /><input type="hidden" name="subject" value={preview.proposed.subject} /><input type="hidden" name="body" value={preview.proposed.body} />
          <button className="button-primary" disabled={accepting}><Check size={17} /> {accepting ? "Accepting…" : "Accept refinement"}</button>
        </form>
        {previewState.message ? <div className="mt-3"><FormStatus state={previewState} /></div> : null}
      </section> : null}

      <section className="card rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-bold">Review decision</h2><div className="mt-4 flex flex-wrap gap-3">
        {props.status !== "approved" ? <form action={approveAction}><button className="button-primary" disabled={approving}><Check size={17} /> {approving ? "Approving…" : "Approve"}</button></form> : <span className="rounded-full bg-[#ecfdf3] px-3 py-2 text-sm font-bold text-[#067647]">Approved</span>}
        <form action={excludeAction} onSubmit={(event) => { if (!window.confirm("Exclude this recipient from sending?")) event.preventDefault(); }}><button className="button-secondary text-[#b42318]" disabled={excluding}><UserMinus size={17} /> {excluding ? "Excluding…" : "Exclude recipient"}</button></form>
      </div>{approveState.message ? <div className="mt-3"><FormStatus state={approveState} /></div> : null}{excludeState.message ? <div className="mt-3"><FormStatus state={excludeState} /></div> : null}</section>
    </> : null}
  </div>;
}

"use client";

import { AlertTriangle, LoaderCircle, MailCheck, RefreshCw } from "lucide-react";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/form-status";
import { finishCampaignAction } from "@/lib/actions/sending";
import { initialActionState } from "@/lib/actions/state";

export type SendProgress = { total: number; sent: number; pending: number; failed: number; uncertain: number; excluded: number; retryable: number };

export function CampaignSendingControls({ campaignId, campaignStatus, initial, credentialInvalid, finishSummary, senderEmail }: {
  campaignId: string;
  senderEmail: string;
  campaignStatus: string;
  initial: SendProgress;
  credentialInvalid: boolean;
  finishSummary: string;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [serverProgress, setServerProgress] = useState(initial);
  if (initial !== serverProgress) {
    setServerProgress(initial);
    setProgress(initial);
  }
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"send" | "retry" | "reconnect" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [finishState, finishAction, finishing] = useActionState(finishCampaignAction.bind(null, campaignId), initialActionState);

  async function run(retryFailed: boolean) {
    setBusy(retryFailed ? "retry" : "send"); setError(""); setNotice("");
    const retryBefore = new Date().toISOString();
    try {
      for (;;) {
        const response = await fetch(`/api/campaigns/${campaignId}/send`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retryFailed, confirmed: true, senderEmail, retryBefore }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Sending could not continue.");
        setProgress(result as SendProgress);
        router.refresh();
        if (result.haltReason) {
          if (result.haltReason === "idle") { setNotice("No email was claimed. Another send may be active or the sender is cooling down. Refresh before resuming."); break; }
          setError(result.haltReason === "daily_limit" ? "The rolling 24-hour sending limit has been reached." : result.haltReason === "smtp_auth" ? "Gmail authentication failed. Reconnect the frozen sender to continue." : "Sending paused after an SMTP problem. Review the delivery log.");
          break;
        }
        if (!result.processed || (retryFailed ? result.retryable === 0 : result.pending === 0)) break;
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sending could not continue.");
    } finally { setBusy(null); router.refresh(); }
  }

  async function reconnect() {
    setBusy("reconnect"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/send/reconnect`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appPassword: password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Gmail could not be reconnected.");
      setPassword(""); setNotice(result.message); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Gmail could not be reconnected."); }
    finally { setBusy(null); }
  }

  const open = ["draft", "sending"].includes(campaignStatus);
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {[["Queued", progress.total], ["Sent", progress.sent], ["Pending", progress.pending], ["Failed", progress.failed], ["Uncertain", progress.uncertain], ["Excluded", progress.excluded]].map(([label, value]) => <div key={label} className="rounded-xl border border-[#e1e9e6] bg-[#f8faf9] p-3.5"><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-[#65736f]">{label}</p></div>)}
    </div>
    {open ? <label className="flex items-start gap-3 rounded-xl border border-[#dce6e2] bg-white p-4 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 size-4" /><span>I confirm that Relaycraft may send the currently approved emails using this campaign’s frozen Gmail sender.</span></label> : null}
    {open ? <div className="flex flex-wrap gap-3"><button type="button" className="button-primary" disabled={!confirmed || busy !== null || credentialInvalid || progress.pending === 0} onClick={() => run(false)}>{busy === "send" ? <LoaderCircle className="animate-spin" size={17} /> : <MailCheck size={17} />}{campaignStatus === "draft" ? "Send Approved Emails" : "Resume Approved Emails"}</button>{progress.retryable > 0 ? <button type="button" className="button-secondary" disabled={!confirmed || busy !== null || credentialInvalid} onClick={() => run(true)}>{busy === "retry" ? <LoaderCircle className="animate-spin" size={17} /> : <RefreshCw size={17} />} Retry eligible failures</button> : null}</div> : null}
    {credentialInvalid && campaignStatus === "sending" ? <div className="rounded-2xl border border-[#f5cf87] bg-[#fffaf0] p-5"><div className="flex gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-[#9a6700]" size={20} /><div><h3 className="font-bold">Reconnect the frozen Gmail sender</h3><p className="mt-1 text-sm text-[#6f5a24]">Enter a new Google App Password. The sender email cannot be changed for this campaign.</p></div></div><input className="field mt-4" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Google App Password" /><button type="button" className="button-primary mt-3" disabled={busy !== null || !password.replaceAll(" ", "")} onClick={reconnect}>{busy === "reconnect" ? <LoaderCircle className="animate-spin" size={17} /> : <RefreshCw size={17} />} Reconnect Gmail</button></div> : null}
    {error ? <p role="alert" className="rounded-xl border border-[#fecdca] bg-[#fef3f2] px-3.5 py-3 text-sm text-[#b42318]">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl border border-[#a6dfc6] bg-[#ecfdf3] px-3.5 py-3 text-sm text-[#067647]">{notice}</p> : null}
    {campaignStatus === "sending" ? <div className="border-t border-[#e1e9e6] pt-5"><form action={finishAction} onSubmit={(event) => { if (!window.confirm(`Finish this campaign? ${finishSummary} Nothing else will be sent.`)) event.preventDefault(); }}><button className="button-secondary text-[#b42318]" disabled={finishing || busy !== null}>{finishing ? "Finishing…" : "Finish Campaign"}</button></form>{finishState.message ? <div className="mt-3"><FormStatus state={finishState} /></div> : null}</div> : null}
  </div>;
}

export function RetrySendButton({ campaignId, draftId, disabled, senderEmail }: { campaignId: string; draftId: string; disabled?: boolean; senderEmail: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function retry() {
    if (!window.confirm("Retry this failed email now?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retryFailed: true, draftId, confirmed: true, senderEmail }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Retry failed.");
      if (result.haltReason && result.haltReason !== "idle") throw new Error("Retry paused. Review the campaign delivery status.");
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Retry failed."); }
    finally { setBusy(false); }
  }
  return <div><button type="button" className="text-xs font-bold text-[#146c54] hover:underline disabled:opacity-50" disabled={busy || disabled} onClick={retry}>{busy ? "Retrying…" : "Retry"}</button>{error ? <p className="mt-1 max-w-48 text-xs text-[#b42318]">{error}</p> : null}</div>;
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles } from "lucide-react";

type Progress = {
  total: number;
  generated: number;
  failed: number;
  pending: number;
  processing: number;
  claimed: number;
  haltReason: "invalid_key" | "rate_limited" | null;
};

export function GenerateDrafts({
  campaignId,
  total,
  generated,
  failed,
  pending,
  processing,
}: {
  campaignId: string;
  total: number;
  generated: number;
  failed: number;
  pending: number;
  processing: number;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>({
    total,
    generated,
    failed,
    pending,
    processing,
    claimed: 0,
    haltReason: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    let retryFailed = true;
    try {
      for (;;) {
        const response = await fetch(`/api/campaigns/${campaignId}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retryFailed }),
        });
        const result = await response.json();
        if (!response.ok) {
          setError(result.message ?? "Draft generation could not continue.");
          break;
        }
        const current = result as Progress;
        setProgress(current);
        router.refresh();
        retryFailed = false;
        if (current.haltReason) {
          setError(
            current.haltReason === "invalid_key"
              ? "The provider rejected your API key. Replace it in Settings."
              : "The provider is rate-limiting requests. Try again later.",
          );
          break;
        }
        if (!current.claimed || current.pending === 0) break;
      }
    } catch {
      setError("Could not reach the server. Saved drafts are safe; try again.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="card rounded-[24px] p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-bold">AI email drafts</h3>
          <p className="mt-1 text-sm text-[#65736f]">
            Generate personalized drafts in small batches. Nothing will be sent.
          </p>
        </div>
        <button
          type="button"
          className="button-primary"
          disabled={busy || total === 0 || progress.generated === total}
          onClick={start}
        >
          {busy ? (
            <LoaderCircle size={17} className="animate-spin" />
          ) : (
            <Sparkles size={17} />
          )}
          {busy
            ? " Generating…"
            : progress.generated + progress.failed > 0
              ? " Resume / retry drafts"
              : " Generate Drafts"}
        </button>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Recipients", progress.total],
          ["Generated", progress.generated],
          ["Failed", progress.failed],
          ["Pending", progress.pending + progress.processing],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-[#e6ece9] bg-[#f8faf9] p-3.5"
          >
            <p className="text-2xl font-bold tracking-[-.03em]">{value}</p>
            <p className="mt-1 text-xs text-[#65736f]">{label}</p>
          </div>
        ))}
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-3.5 py-3 text-sm text-[#b42318]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

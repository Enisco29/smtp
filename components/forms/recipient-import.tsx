"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import type { CsvPreview } from "@/lib/csv/recipients";

type SignedPreview = CsvPreview & { token: string };

export function RecipientImport({ campaignId, hasRecipients }: { campaignId: string; hasRecipients: boolean }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SignedPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(endpoint: "preview" | "confirm") {
    if (!file) return;
    if (endpoint === "confirm" && hasRecipients && !window.confirm(
      "Replace the recipient list? This also deletes any drafts generated for the current recipients."
    )) return;
    setBusy(endpoint);
    setError("");
    setSuccess("");
    const form = new FormData();
    form.append("file", file);
    if (endpoint === "confirm" && preview) form.append("token", preview.token);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/import/${endpoint}`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) {
        setPreview(null);
        setError(result.message ?? "Could not process the CSV file.");
        return;
      }
      if (endpoint === "preview") setPreview(result as SignedPreview);
      else {
        setPreview(null);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        setSuccess(`${result.imported} recipient${result.imported === 1 ? "" : "s"} imported.`);
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="card rounded-[24px] p-6 sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#e5f3ed] text-[#146c54]"><FileSpreadsheet size={20} /></span><div><h3 className="font-bold">Recipient CSV</h3><p className="text-xs text-[#71807b]">UTF-8 .csv · up to 2 MB and 5,000 rows</p></div></div>{hasRecipients ? <span className="rounded-full bg-[#f3f6f5] px-3 py-1 text-xs font-semibold text-[#53645f]">Confirming replaces the current list</span> : null}</div>
    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center"><input ref={fileInput} aria-label="Choose recipient CSV" className="field file:mr-4 file:rounded-lg file:border-0 file:bg-[#e5f3ed] file:px-3 file:py-1.5 file:font-semibold file:text-[#146c54]" type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setError(""); setSuccess(""); }} /><button type="button" disabled={!file || busy !== null} onClick={() => submit("preview")} className="button-primary shrink-0">{busy === "preview" ? <LoaderCircle size={17} className="animate-spin" /> : <Upload size={17} />} {busy === "preview" ? "Checking…" : "Preview CSV"}</button></div>
    {error ? <p role="alert" className="mt-4 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-3.5 py-3 text-sm text-[#b42318]">{error}</p> : null}
    {success ? <p role="status" className="mt-4 rounded-xl border border-[#a6dfc6] bg-[#ecfdf3] px-3.5 py-3 text-sm text-[#067647]">{success}</p> : null}
    {preview ? <div className="mt-7 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[
        ["Total rows", preview.totalRows], ["Valid recipients", preview.validRecipients], ["Invalid rows", preview.invalidRows], ["Duplicates", preview.duplicates],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-[#e6ece9] bg-[#f8faf9] p-3.5"><p className="text-2xl font-bold tracking-[-.03em]">{value}</p><p className="mt-1 text-xs text-[#65736f]">{label}</p></div>)}</div>
      {preview.issues.length ? <div><h4 className="font-bold">Rows to review</h4><div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-[#f0d4d1] bg-[#fffafa]"><ul className="divide-y divide-[#f7e7e4] text-sm">{preview.issues.map((issue) => <li key={`${issue.row}-${issue.kind}`} className="flex gap-3 px-4 py-2.5"><span className="shrink-0 font-semibold text-[#b42318]">Row {issue.row}</span><span className="text-[#70504c]">{issue.message}</span></li>)}</ul></div></div> : null}
      <div><h4 className="font-bold">Preview <span className="font-normal text-[#71807b]">(first {preview.previewRows.length} rows)</span></h4><div className="mt-3 overflow-x-auto rounded-xl border border-[#e6ece9]"><table className="min-w-full text-left text-sm"><thead className="bg-[#f7faf8] text-xs font-semibold text-[#60716a]"><tr><th className="px-4 py-3">Row</th>{preview.columns.map((column) => <th key={column} className="whitespace-nowrap px-4 py-3">{column}</th>)}<th className="px-4 py-3">Result</th></tr></thead><tbody className="divide-y divide-[#edf1ef]">{preview.previewRows.map((row) => <tr key={row.row}><td className="px-4 py-3 text-[#71807b]">{row.row}</td>{preview.columns.map((column) => <td key={column} className="max-w-60 truncate whitespace-nowrap px-4 py-3" title={column === "email" ? row.email : row.data[column] ?? ""}>{column === "email" ? row.email : row.data[column] ?? ""}</td>)}<td className={`whitespace-nowrap px-4 py-3 text-xs font-semibold ${row.issue ? "text-[#b42318]" : "text-[#067647]"}`}>{row.issue ? row.issue.replaceAll("_", " ") : "Valid"}</td></tr>)}</tbody></table></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6ece9] pt-5"><p className="max-w-lg text-sm leading-6 text-[#65736f]">Only valid recipients will be saved. If you need to fix the CSV, select the corrected file and preview it again.</p><button type="button" disabled={preview.validRecipients === 0 || busy !== null} onClick={() => submit("confirm")} className="button-primary shrink-0">{busy === "confirm" ? <LoaderCircle size={17} className="animate-spin" /> : <Check size={17} />} {busy === "confirm" ? "Importing…" : `Confirm ${preview.validRecipients} recipients`}</button></div>
    </div> : null}
  </div>;
}

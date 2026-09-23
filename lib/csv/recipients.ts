import { createHash } from "node:crypto";
import { z } from "zod";

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;
export const PREVIEW_ROWS = 50;

export type RecipientInput = { email: string; data: Record<string, string> };
export type RowIssue = { row: number; kind: "empty_row" | "missing_email" | "invalid_email" | "malformed_row" | "duplicate"; message: string };
export type PreviewRow = { row: number; email: string; data: Record<string, string>; issue: RowIssue["kind"] | null };
export type CsvPreview = {
  digest: string;
  columns: string[];
  totalRows: number;
  validRecipients: number;
  invalidRows: number;
  duplicates: number;
  issues: RowIssue[];
  previewRows: PreviewRow[];
};

export class CsvValidationError extends Error {}

type CsvRecord = { row: number; fields: string[] };

function parseRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let row = 1;
  let recordStart = 1;

  const finishRecord = () => {
    fields.push(field);
    records.push({ row: recordStart, fields });
    fields = [];
    field = "";
    afterQuote = false;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (char === "\r" || char === "\n") {
        field += "\n";
        if (char === "\r" && text[index + 1] === "\n") index++;
        row++;
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuote && char !== "," && char !== "\r" && char !== "\n") {
      throw new CsvValidationError(`Malformed CSV near row ${recordStart}.`);
    }
    if (char === '"') {
      if (field.length > 0 || afterQuote) throw new CsvValidationError(`Malformed CSV near row ${recordStart}.`);
      inQuotes = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
      afterQuote = false;
    } else if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && text[index + 1] === "\n") index++;
      row++;
      recordStart = row;
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new CsvValidationError(`Unclosed quoted value near row ${recordStart}.`);
  if (field.length > 0 || fields.length > 0 || afterQuote) finishRecord();
  return records;
}

export function parseRecipientCsv(text: string) {
  const records = parseRecords(text.replace(/^\uFEFF/, ""));
  if (records.length === 0) throw new CsvValidationError("The CSV file is empty.");
  const columns = records[0].fields.map((field) => field.trim());
  if (columns.some((column) => !column)) throw new CsvValidationError("Every CSV column needs a name.");
  if (new Set(columns.map((column) => column.toLowerCase())).size !== columns.length) {
    throw new CsvValidationError("The CSV has duplicate column names.");
  }
  const emailIndex = columns.indexOf("email");
  if (emailIndex < 0) throw new CsvValidationError('The CSV needs a column named "email".');
  const dataRows = records.slice(1);
  if (dataRows.length > MAX_CSV_ROWS) throw new CsvValidationError(`The CSV must have no more than ${MAX_CSV_ROWS} data rows.`);

  const seen = new Set<string>();
  const validRecipients: RecipientInput[] = [];
  const issues: RowIssue[] = [];
  const previewRows: PreviewRow[] = [];
  let invalidRows = 0;
  let duplicates = 0;

  for (const record of dataRows) {
    const values = columns.map((_, index) => record.fields[index] ?? "");
    const email = values[emailIndex].trim().toLowerCase();
    const data = Object.fromEntries(
      columns.flatMap((column, index) => index === emailIndex ? [] : [[column, values[index]]]),
    ) as Record<string, string>;

    let kind: RowIssue["kind"] | null = null;
    let message = "";
    if (record.fields.length > columns.length) {
      kind = "malformed_row";
      message = "This row has more values than the header.";
    } else if (values.every((value) => value.trim() === "")) {
      kind = "empty_row";
      message = "Empty row.";
    } else if (!email) {
      kind = "missing_email";
      message = "Missing email value.";
    } else if (!z.string().email().safeParse(email).success) {
      kind = "invalid_email";
      message = "Invalid email address.";
    } else if (seen.has(email)) {
      kind = "duplicate";
      message = "Duplicate email address in this CSV.";
    }

    if (kind) {
      issues.push({ row: record.row, kind, message });
      if (kind === "duplicate") duplicates++;
      else invalidRows++;
    } else {
      seen.add(email);
      validRecipients.push({ email, data });
    }
    if (previewRows.length < PREVIEW_ROWS) previewRows.push({ row: record.row, email, data, issue: kind });
  }

  return { columns, totalRows: dataRows.length, validRecipients, invalidRows, duplicates, issues, previewRows };
}

export async function inspectCsvFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".csv")) throw new CsvValidationError("Upload a .csv file.");
  if (file.size === 0) throw new CsvValidationError("The CSV file is empty.");
  if (file.size > MAX_CSV_BYTES) throw new CsvValidationError("The CSV file must be 2 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CsvValidationError("The CSV file must be UTF-8 encoded.");
  }
  const parsed = parseRecipientCsv(text);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const preview: CsvPreview = {
    digest,
    columns: parsed.columns,
    totalRows: parsed.totalRows,
    validRecipients: parsed.validRecipients.length,
    invalidRows: parsed.invalidRows,
    duplicates: parsed.duplicates,
    issues: parsed.issues,
    previewRows: parsed.previewRows,
  };
  return { preview, recipients: parsed.validRecipients };
}

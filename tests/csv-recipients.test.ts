import { describe, expect, it } from "vitest";
import { CsvValidationError, inspectCsvFile, parseRecipientCsv } from "@/lib/csv/recipients";

describe("recipient CSV parsing", () => {
  it("preserves arbitrary fields and quoted commas, quotes, and line breaks", () => {
    const parsed = parseRecipientCsv('\uFEFFemail,company,custom_note\r\n" ALICE@Example.COM ","Acme, Inc.","Line 1\r\n""quoted"" line"\r\n');
    expect(parsed.totalRows).toBe(1);
    expect(parsed.validRecipients).toEqual([{
      email: "alice@example.com",
      data: { company: "Acme, Inc.", custom_note: 'Line 1\n"quoted" line' },
    }]);
  });
  it("preserves special custom column names as JSON fields", () => {
    const parsed = parseRecipientCsv("email,__proto__\na@example.com,custom");
    const data = parsed.validRecipients[0].data;
    expect(Object.hasOwn(data, "__proto__")).toBe(true);
    expect(JSON.stringify(data)).toContain('"__proto__":"custom"');
  });

  it("reports invalid rows separately from duplicates and keeps the first valid email", () => {
    const parsed = parseRecipientCsv("email,first_name,custom\nJane@Example.com,Jane,A\njane@example.com,Other,B\n,Missing,C\nnot-an-email,Bad,D\n,,\n");
    expect(parsed.totalRows).toBe(5);
    expect(parsed.validRecipients).toEqual([{ email: "jane@example.com", data: { first_name: "Jane", custom: "A" } }]);
    expect(parsed.invalidRows).toBe(3);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.issues.map((issue) => issue.kind)).toEqual(["duplicate", "missing_email", "invalid_email", "empty_row"]);
  });

  it("requires an exact email header and rejects duplicate or blank headers", () => {
    expect(() => parseRecipientCsv("Email,name\na@example.com,A")).toThrow('column named "email"');
    expect(() => parseRecipientCsv("email,company,Company\na@example.com,A,B")).toThrow("duplicate column names");
    expect(() => parseRecipientCsv("email, \na@example.com,A")).toThrow("needs a name");
  });

  it("rejects malformed quoted CSV", () => {
    expect(() => parseRecipientCsv('email,note\na@example.com,"unfinished')).toThrow(CsvValidationError);
  });

  it("rejects unsupported files and computes a digest of the original bytes", async () => {
    const csv = "email,custom\na@example.com,one";
    await expect(inspectCsvFile(new File([csv], "recipients.txt"))).rejects.toThrow(".csv");
    const first = await inspectCsvFile(new File([csv], "recipients.csv"));
    const second = await inspectCsvFile(new File([csv + "\n"], "recipients.csv"));
    expect(first.preview.digest).not.toBe(second.preview.digest);
    expect(first.preview.validRecipients).toBe(1);
  });
});

import { z } from "zod";

export const draftStatuses = [
  "pending",
  "processing",
  "generated",
  "edited",
  "approved",
  "failed",
  "excluded",
  "sending",
  "sent",
  "send_failed",
  "uncertain",
] as const;

export type DraftStatus = (typeof draftStatuses)[number];

export const draftContentSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required.").max(300),
  body: z.string().trim().min(1, "Email body is required.").max(20_000),
  revision: z.coerce.number().int().positive(),
});

export const refinementSchema = z.object({
  instructions: z.string().trim().min(1, "Describe the change you want.").max(1_000),
  revision: z.coerce.number().int().positive(),
});

export function recipientName(data: Record<string, unknown> | null | undefined) {
  return [data?.first_name, data?.last_name]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function needsAttention(status: DraftStatus) {
  return !["approved", "excluded", "sent"].includes(status);
}

import "server-only";
import { z } from "zod";

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const schema = z.object({
  dailyLimit: integer(100, 1, 500),
  delayMs: integer(2000, 1000, 10_000),
  batchSize: integer(10, 1, 10),
});

export function getSmtpSendConfig() {
  return schema.parse({
    dailyLimit: process.env.SMTP_DAILY_SEND_LIMIT || undefined,
    delayMs: process.env.SMTP_SEND_DELAY_MS || undefined,
    batchSize: process.env.SMTP_SEND_BATCH_SIZE || undefined,
  });
}

export const SMTP_ROUTE_BUDGET_MS = 50_000;
export const SMTP_MIN_ATTEMPT_BUDGET_MS = 30_000;

export function hasSmtpAttemptBudget(startedAt: number, delayMs: number, now = Date.now()) {
  return SMTP_ROUTE_BUDGET_MS - (now - startedAt) >= SMTP_MIN_ATTEMPT_BUDGET_MS + delayMs;
}

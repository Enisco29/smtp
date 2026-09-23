import "server-only";
import nodemailer from "nodemailer";
import { smtpErrorMessage } from "@/lib/smtp/errors";

export type SmtpVerificationResult =
  | { ok: true }
  | { ok: false; message: string };

export async function verifyGmailCredentials(
  email: string,
  appPassword: string,
): Promise<SmtpVerificationResult> {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: email, pass: appPassword },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 18_000,
  });
  try {
    await transport.verify();
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      message: smtpErrorMessage(
        error as { code?: string; responseCode?: number },
      ),
    };
  } finally {
    transport.close();
  }
}

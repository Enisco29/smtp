import "server-only";
import nodemailer from "nodemailer";
import { classifySmtpFailure, SmtpPhase, type DeliveryResult, type SmtpError } from "@/lib/smtp/delivery";

export type { DeliveryResult } from "@/lib/smtp/delivery";
export const SMTP_ATTEMPT_TIMEOUT_MS = 22_000;

export async function sendGmailMessage(input: {
  senderName: string | null;
  senderEmail: string;
  appPassword: string;
  recipientEmail: string;
  subject: string;
  body: string;
}): Promise<DeliveryResult> {
  const phase = new SmtpPhase();
  const discard = () => {};
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: input.senderEmail, pass: input.appPassword },
    connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000,
    transactionLog: true,
    logger: { trace: discard, debug: (data: { tnx?: string }, message: string) => phase.observe(data, message), info: discard, warn: discard, error: discard, fatal: discard },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        transport.close();
        reject({ code: "ETIMEDOUT" });
      }, SMTP_ATTEMPT_TIMEOUT_MS);
    });
    const info = await Promise.race([transport.sendMail({
      from: { name: input.senderName ?? "", address: input.senderEmail },
      to: input.recipientEmail,
      envelope: { from: input.senderEmail, to: [input.recipientEmail] },
      subject: input.subject, text: input.body,
    }), timeout]);
    const accepted = (info.accepted ?? []).map(String).some((email) => email.toLowerCase() === input.recipientEmail.toLowerCase());
    if (accepted) return { status: "sent" };
    const rejection = (info.rejectedErrors?.[0] ?? { responseCode: 550 }) as SmtpError;
    return classifySmtpFailure(rejection, phase.transmitted);
  } catch (error) {
    if (phase.accepted) return { status: "sent" };
    const failure = (error ?? {}) as SmtpError;
    return classifySmtpFailure({ ...failure, responseCode: failure.responseCode ?? phase.rejectionCode }, phase.transmitted);
  } finally {
    if (timer) clearTimeout(timer);
    transport.close();
  }
}

export type DeliveryResult =
  | { status: "sent" }
  | { status: "send_failed" | "uncertain"; code: string; message: string; retryable: boolean; halt: boolean };

export type SmtpError = { code?: string; command?: string; responseCode?: number; response?: string };

export function classifySmtpFailure(error: SmtpError, transmitted = false): DeliveryResult {
  if (error.code === "EAUTH" || [534, 535].includes(error.responseCode ?? 0)) {
    return { status: "send_failed", code: "smtp_auth", message: "Gmail rejected the campaign credential. Reconnect this sender with a new App Password.", retryable: true, halt: true };
  }
  if (/5\.4\.5|daily.*limit|sending.*limit|quota.*exceeded|rate.?limit|too many/i.test(error.response ?? "")) {
    return { status: "send_failed", code: "smtp_rate_limited", message: "Gmail limited account sending. Wait before retrying.", retryable: true, halt: true };
  }
  if ((error.responseCode ?? 0) >= 400 && (error.responseCode ?? 0) < 500) {
    return { status: "send_failed", code: "smtp_rate_limited", message: "Gmail reported a temporary restriction. Wait before retrying.", retryable: true, halt: true };
  }
  if ((error.responseCode ?? 0) >= 500) {
    return { status: "send_failed", code: "recipient_rejected", message: "Gmail permanently rejected this recipient or message.", retryable: false, halt: false };
  }
  if (transmitted) {
    return { status: "uncertain", code: "delivery_uncertain", message: "Transmission began, but Gmail acceptance could not be confirmed. Inspect this delivery manually.", retryable: false, halt: true };
  }
  return { status: "send_failed", code: "smtp_connection", message: "The message was not transmitted because the SMTP connection failed.", retryable: true, halt: true };
}

// Observes only protocol phase markers. Nothing is logged, retained, or forwarded.
export class SmtpPhase {
  dataRequested = false;
  transmitted = false;
  accepted = false;
  private outcomeEstablished = false;
  rejectionCode: number | undefined;

  observe(data: { tnx?: string }, message: string) {
    if (data.tnx === "client" && message === "DATA") this.dataRequested = true;
    if (data.tnx !== "server" || !this.dataRequested || this.outcomeEstablished) return;
    const code = Number(message.slice(0, 3));
    if (code === 354 && !this.transmitted) { this.transmitted = true; return; }
    if (code >= 400) { this.rejectionCode = code; this.outcomeEstablished = true; }
    if (code >= 200 && code < 300 && this.transmitted) { this.accepted = true; this.outcomeEstablished = true; }
  }
}

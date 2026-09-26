import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));
import { sendGmailMessage, SMTP_ATTEMPT_TIMEOUT_MS } from "@/lib/smtp/send";
import { classifySmtpFailure, SmtpPhase } from "@/lib/smtp/delivery";
import { getSmtpSendConfig, hasSmtpAttemptBudget } from "@/lib/smtp/send-config";

const input = { senderName: "Ada", senderEmail: "ada@gmail.com", appPassword: "private-password", recipientEmail: "alex@example.com", subject: "Approved subject", body: "Exact approved body\nwith whitespace." };
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("SMTP delivery safety", () => {
  it("sends exact approved plain text with one recipient and closes the connection", async () => {
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close });
    mocks.sendMail.mockResolvedValue({ accepted: [input.recipientEmail] });
    expect(await sendGmailMessage(input)).toEqual({ status: "sent" });
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: input.subject, text: input.body, envelope: { from: input.senderEmail, to: [input.recipientEmail] } }));
    expect(mocks.sendMail.mock.calls[0][0].html).toBeUndefined();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each([
    [{ code: "EAUTH", responseCode: 535 }, false, "send_failed", "smtp_auth"],
    [{ code: "ETIMEDOUT", command: "CONN" }, false, "send_failed", "smtp_connection"],
    [{ code: "ESOCKET" }, true, "uncertain", "delivery_uncertain"],
    [{ responseCode: 451 }, true, "send_failed", "smtp_rate_limited"],
    [{ responseCode: 550 }, true, "send_failed", "recipient_rejected"],
  ] as const)("classifies SMTP outcome safely: %j", (error, transmitted, status, code) => {
    const result = classifySmtpFailure(error, transmitted);
    expect(result).toMatchObject({ status, code });
    if (status === "uncertain") expect(result).toMatchObject({ retryable: false });
  });

  it("tracks DATA permission and final acceptance without treating RCPT acceptance as delivery", () => {
    const phase = new SmtpPhase();
    phase.observe({ tnx: "server" }, "250 Recipient OK");
    expect(phase.accepted).toBe(false);
    phase.observe({ tnx: "client" }, "DATA");
    expect(phase.transmitted).toBe(false);
    phase.observe({ tnx: "server" }, "354 Go ahead");
    expect(phase.transmitted).toBe(true);
    phase.observe({ tnx: "server" }, "250 Message accepted");
    expect(phase.accepted).toBe(true);
  });

  it("does not mistake connection cleanup for acceptance after DATA rejection", () => {
    const phase = new SmtpPhase();
    phase.observe({ tnx: "client" }, "DATA");
    phase.observe({ tnx: "server" }, "354 Go ahead");
    phase.observe({ tnx: "server" }, "550 Message rejected");
    phase.observe({ tnx: "server" }, "221 Goodbye");
    expect(phase.accepted).toBe(false);
    expect(phase.rejectionCode).toBe(550);
  });

  it("enforces an absolute deadline before transmission", async () => {
    vi.useFakeTimers();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close });
    mocks.sendMail.mockReturnValue(new Promise(() => {}));
    const result = sendGmailMessage(input);
    await vi.advanceTimersByTimeAsync(SMTP_ATTEMPT_TIMEOUT_MS);
    expect(await result).toMatchObject({ status: "send_failed", retryable: true });
  });

  it("marks interrupted transmission uncertain, and never logs provider content", async () => {
    vi.useFakeTimers();
    mocks.createTransport.mockImplementation((options) => {
      options.logger.debug({ tnx: "client" }, "DATA");
      options.logger.debug({ tnx: "server" }, "354 Go ahead");
      return { sendMail: mocks.sendMail, close: mocks.close };
    });
    mocks.sendMail.mockReturnValue(new Promise(() => {}));
    const result = sendGmailMessage(input);
    await vi.advanceTimersByTimeAsync(SMTP_ATTEMPT_TIMEOUT_MS);
    expect(await result).toMatchObject({ status: "uncertain", retryable: false });
  });

  it("rejects missing acceptance and respects explicit temporary rejection", async () => {
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close });
    mocks.sendMail.mockResolvedValue({ accepted: [], rejectedErrors: [{ responseCode: 450 }] });
    expect(await sendGmailMessage(input)).toMatchObject({ status: "send_failed", retryable: true });
  });

  it("stops before the remaining request budget cannot cover pacing and a full attempt", () => {
    expect(hasSmtpAttemptBudget(0, 2000, 18_000)).toBe(true);
    expect(hasSmtpAttemptBudget(0, 2000, 18_001)).toBe(false);
  });

  it("recognizes Gmail daily quota replies without retaining raw responses", () => {
    const result = classifySmtpFailure({ responseCode: 550, response: "5.4.5 Daily user sending limit exceeded. private-response" }, true);
    expect(result).toMatchObject({ status: "send_failed", code: "smtp_rate_limited", retryable: true });
    expect(JSON.stringify(result)).not.toContain("private-response");
  });

  it("loads conservative defaults and rejects unsafe configuration", () => {
    for (const name of ["SMTP_DAILY_SEND_LIMIT", "SMTP_SEND_DELAY_MS", "SMTP_SEND_BATCH_SIZE"]) vi.stubEnv(name, "");
    expect(getSmtpSendConfig()).toEqual({ dailyLimit: 100, delayMs: 2000, batchSize: 10 });
    vi.stubEnv("SMTP_SEND_DELAY_MS", "0");
    expect(() => getSmtpSendConfig()).toThrow();
  });
});

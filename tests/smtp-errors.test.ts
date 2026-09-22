import { describe, expect, it } from "vitest";
import { smtpErrorMessage } from "@/lib/smtp/errors";

describe("SMTP error messages", () => {
  it("explains App Password and Workspace policy failures", () => {
    const message = smtpErrorMessage({ code: "EAUTH", responseCode: 535 });
    expect(message).toContain("Google App Password");
    expect(message).toContain("administrator may have disabled");
  });

  it("uses a connection-specific message for timeouts", () => {
    expect(smtpErrorMessage({ code: "ETIMEDOUT" })).toContain("could not reach Gmail");
  });

  it("does not expose unknown provider details", () => {
    expect(smtpErrorMessage({ code: "UNKNOWN" })).toBe("Gmail could not verify these credentials. Confirm the address and App Password, then try again.");
  });
});

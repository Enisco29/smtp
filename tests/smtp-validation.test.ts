import { describe, expect, it } from "vitest";
import { onboardingSchema, settingsSchema } from "@/lib/validation/smtp";

describe("SMTP input validation", () => {
  it("removes all spaces without enforcing a fixed App Password length", () => {
    const result = onboardingSchema.parse({ name: "", senderName: "", senderEmail: "USER@workspace.example", appPassword: "a bc 12" });
    expect(result.appPassword).toBe("abc12");
  });

  it("rejects a whitespace-only credential", () => {
    expect(onboardingSchema.safeParse({ name: "", senderName: "", senderEmail: "user@example.com", appPassword: "   " }).success).toBe(false);
  });

  it("allows a blank settings password to preserve the existing credential", () => {
    expect(settingsSchema.parse({ senderName: "Sender", senderEmail: "user@example.com", appPassword: " " }).appPassword).toBe("");
  });
});

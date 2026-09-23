import { describe, expect, it } from "vitest";
import { campaignSchema } from "@/lib/campaigns/validation";

describe("campaign form", () => {
  it("accepts a name and non-empty instructions", () => {
    expect(campaignSchema.parse({ name: " Outreach ", instructions: " Reach founders " })).toEqual({
      name: "Outreach", instructions: "Reach founders",
    });
  });

  it("rejects whitespace-only instructions", () => {
    expect(campaignSchema.safeParse({ name: "Outreach", instructions: "  " }).success).toBe(false);
  });
});

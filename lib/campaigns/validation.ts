import { z } from "zod";

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Enter a campaign name.").max(120, "Keep the name under 120 characters."),
  instructions: z.string().trim().min(1, "Enter your email instructions."),
});

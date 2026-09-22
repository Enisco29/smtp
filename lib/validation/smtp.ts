import { z } from "zod";

const optionalName = z.string().trim().max(100, "Keep this under 100 characters.").transform((value) => value || null);

export const onboardingSchema = z.object({
  name: optionalName,
  senderName: optionalName,
  senderEmail: z.string().trim().email("Enter a valid Gmail or Google Workspace address."),
  appPassword: z.string().transform((value) => value.replace(/\s/g, "")).refine(Boolean, "Enter your Google App Password."),
});

export const settingsSchema = z.object({
  senderName: optionalName,
  senderEmail: z.string().trim().email("Enter a valid Gmail or Google Workspace address."),
  appPassword: z.string().transform((value) => value.replace(/\s/g, "")),
});

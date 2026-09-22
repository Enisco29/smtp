import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const signupSchema = loginSchema.extend({
  password: z.string().min(8, "Use at least 8 characters."),
});

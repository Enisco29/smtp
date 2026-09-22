import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "@/components/forms/signup-form";
import { redirectIfAuthenticated } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  await redirectIfAuthenticated();
  return <AuthShell eyebrow="Get started" title="Create your account" description="Set up your secure sender profile, then you’ll be ready for personalized campaigns."><SignupForm /></AuthShell>;
}

import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/forms/login-form";
import { redirectIfAuthenticated } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await redirectIfAuthenticated();
  const { error } = await searchParams;
  return <AuthShell eyebrow="Welcome back" title="Log in to your workspace" description="Continue building thoughtful outreach with your own sending account."><LoginForm confirmationError={error === "confirmation"} /></AuthShell>;
}

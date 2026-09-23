"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormStatus } from "@/components/form-status";
import { SubmitButton } from "@/components/submit-button";
import { loginAction } from "@/lib/actions/auth";
import { initialActionState } from "@/lib/actions/state";

export function LoginForm({ confirmationError = false }: { confirmationError?: boolean }) {
  const [state, action] = useActionState(loginAction, confirmationError
    ? { status: "error" as const, message: "That confirmation link is invalid or has expired. Request a new signup link and try again." }
    : initialActionState);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} />
      <div><label className="label" htmlFor="email">Email</label><input className="field" id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></div>
      <div><label className="label" htmlFor="password">Password</label><input className="field" id="password" name="password" type="password" autoComplete="current-password" required /></div>
      <SubmitButton pendingLabel="Logging in…">Log in</SubmitButton>
      <p className="text-center text-sm text-[#65736f]">New to Relaycraft? <Link className="font-semibold text-[#146c54]" href="/signup">Create an account</Link></p>
    </form>
  );
}

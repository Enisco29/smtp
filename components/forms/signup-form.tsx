"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormStatus } from "@/components/form-status";
import { SubmitButton } from "@/components/submit-button";
import { signupAction } from "@/lib/actions/auth";
import { initialActionState } from "@/lib/actions/state";

export function SignupForm() {
  const [state, action] = useActionState(signupAction, initialActionState);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} />
      <div><label className="label" htmlFor="email">Email</label><input className="field" id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></div>
      <div><label className="label" htmlFor="password">Password</label><input className="field" id="password" name="password" type="password" autoComplete="new-password" minLength={8} required /><p className="mt-1.5 text-xs text-[#71807b]">At least 8 characters.</p></div>
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      <p className="text-center text-sm text-[#65736f]">Already have an account? <Link className="font-semibold text-[#146c54]" href="/login">Log in</Link></p>
    </form>
  );
}

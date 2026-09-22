import { MailCheck } from "lucide-react";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <AuthShell eyebrow="One more step" title="Check your inbox" description={email ? `We sent a confirmation link to ${email}.` : "We sent you a confirmation link."}>
      <div className="rounded-2xl bg-[#e5f3ed] p-5 text-sm leading-6 text-[#294c41]">
        <MailCheck className="mb-3 text-[#146c54]" size={24} />
        Open the link in the email to confirm your account. You’ll continue directly to sender setup.
      </div>
      <Link href="/login" className="mt-6 block text-center text-sm font-semibold text-[#146c54]">Back to login</Link>
    </AuthShell>
  );
}

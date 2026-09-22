import { AppShell } from "@/components/app-shell";
import { requireOnboardedUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOnboardedUser();
  return <AppShell email={user.email ?? ""}>{children}</AppShell>;
}

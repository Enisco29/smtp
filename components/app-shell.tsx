import { LayoutDashboard, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { logoutAction } from "@/lib/actions/auth";

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-[#dce6e2] bg-white px-5 py-4 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-5 lg:py-7">
        <div className="flex items-center justify-between lg:block"><Brand href="/dashboard" /><span className="max-w-40 truncate text-xs text-[#71807b] lg:hidden">{email}</span></div>
        <nav className="mt-5 flex gap-2 lg:mt-10 lg:flex-col">
          <Link href="/dashboard" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#334c44] hover:bg-[#eef7f3]"><LayoutDashboard size={18} /> Dashboard</Link>
          <Link href="/settings" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#334c44] hover:bg-[#eef7f3]"><Settings size={18} /> Settings</Link>
        </nav>
        <div className="mt-8 hidden border-t border-[#e6ece9] pt-5 lg:block"><p className="mb-3 truncate px-3 text-xs text-[#71807b]">{email}</p><form action={logoutAction}><button className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#53645f] hover:bg-[#f4f7f5]"><LogOut size={17} /> Sign out</button></form></div>
      </aside>
      <main className="px-5 py-8 sm:px-8 lg:px-12 lg:py-10">{children}</main>
    </div>
  );
}

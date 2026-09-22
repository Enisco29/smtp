import { Send } from "lucide-react";
import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 text-[1.05rem] font-bold tracking-[-.02em] text-[#12221e]">
      <span className="grid size-9 place-items-center rounded-xl bg-[#146c54] text-white shadow-sm">
        <Send size={17} strokeWidth={2.4} />
      </span>
      Relaycraft
    </Link>
  );
}

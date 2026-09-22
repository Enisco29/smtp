import { Brand } from "@/components/brand";

export function AuthShell({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen px-5 py-6 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-6xl">
        <Brand />
        <div className="mx-auto grid min-h-[calc(100vh-8rem)] max-w-md content-center py-12">
          <section className="card rounded-[24px] p-6 sm:p-8">
            <p className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-[#146c54]">{eyebrow}</p>
            <h1 className="text-3xl font-bold tracking-[-.04em] text-[#12221e]">{title}</h1>
            <p className="mt-3 text-[.95rem] leading-6 text-[#65736f]">{description}</p>
            <div className="mt-7">{children}</div>
          </section>
        </div>
      </div>
    </main>
  );
}

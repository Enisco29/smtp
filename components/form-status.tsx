import type { ActionState } from "@/lib/actions/state";

export function FormStatus({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <div role={state.status === "error" ? "alert" : "status"} className={state.status === "error"
      ? "rounded-xl border border-[#fecdca] bg-[#fef3f2] px-3.5 py-3 text-sm text-[#b42318]"
      : "rounded-xl border border-[#a6dfc6] bg-[#ecfdf3] px-3.5 py-3 text-sm text-[#067647]"}>
      {state.message}
    </div>
  );
}

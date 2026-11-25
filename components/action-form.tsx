"use client";
// One form wrapper for every server action on these screens: optional confirmation, pending state, result message.
import { startTransition, useActionState, useRef, type ReactNode } from "react";
import { btnClass } from "@/components/ui";
import { FormMessage, type ActionState } from "@/components/ui/client";

export function ActionForm({
  action,
  submit,
  variant,
  confirm,
  reset,
  className,
  children,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  submit: string;
  variant?: "primary" | "secondary" | "danger";
  /** Shown in a confirmation box before an irreversible action. */
  confirm?: string;
  /** Clear the fields after a successful save ("add" forms). */
  reset?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [state, send, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok && reset) form.current?.reset();
    return result;
  }, null);
  return (
    <form
      ref={form}
      className={className}
      // Submitted by hand so a refused save does not reset what the user typed.
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => send(fd));
      }}
    >
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass(variant)}>
          {pending ? "Saving…" : submit}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

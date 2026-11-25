"use client";
// A form that asks before it submits (guide 7: actions that are hard to undo need confirmation).
import { useActionState, type ReactNode } from "react";
import { FormMessage, type ActionState } from "@/components/ui/client";

export function ConfirmForm({ action, confirmText, children }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; confirmText: string; children: ReactNode }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className="space-y-3"
    >
      {children}
      <FormMessage state={state} />
    </form>
  );
}

"use client";
// Client-side shared pieces: nav links, submit button, form message.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { btnClass } from "@/components/ui";

export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return items.map((i) => {
    const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
    return (
      <Link
        key={i.href}
        href={i.href}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-700 ${
          active ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"
        }`}
      >
        {i.label}
      </Link>
    );
  });
}

/** Submit button for a <form action={serverAction}>: disables itself and shows "Saving…" while pending. */
export function SubmitButton({ children, variant, ...p }: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" {...p} disabled={pending || p.disabled} className={`${btnClass(variant)} ${p.className ?? ""}`}>
      {pending ? "Saving…" : children}
    </button>
  );
}

/**
 * Result shape for server actions used with useActionState:
 *   const [state, action] = useActionState(saveThing, null);
 *   <form action={action}> … <FormMessage state={state} /> <SubmitButton>Save</SubmitButton></form>
 */
export type ActionState = { ok: boolean; message: string; fieldErrors?: Record<string, string> } | null;

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`text-sm font-medium ${state.ok ? "text-green-700" : "text-red-700"}`}>
      {state.ok ? "✓ " : ""}
      {state.message}
    </p>
  );
}

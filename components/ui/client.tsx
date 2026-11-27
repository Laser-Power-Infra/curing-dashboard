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
      {state.ok && <span className="tick" aria-hidden>✓ </span>}
      {state.message}
    </p>
  );
}

/** Light / dark switch. The choice is kept on this device; the icon is swapped by CSS, so there is no state to hydrate. */
export function ThemeToggle() {
  return (
    <button
      type="button"
      aria-label="Switch between light and dark"
      title="Light / dark"
      onClick={() => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.theme = next;
        } catch {}
      }}
      className="flex size-11 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-700"
    >
      <svg viewBox="0 0 24 24" className="size-5 dark:hidden" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
      <svg viewBox="0 0 24 24" className="hidden size-5 dark:block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </svg>
    </button>
  );
}

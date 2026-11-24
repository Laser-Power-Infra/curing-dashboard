"use client";
import { useState, useTransition } from "react";
import type { ActionState } from "@/components/ui/client";

// Not <form action>: React clears every field after an action, and a failed save must keep what was typed.
export function useSave<S extends ActionState>(fn: (fd: FormData) => Promise<S>) {
  const [state, setState] = useState<S | null>(null);
  const [pending, start] = useTransition();
  const save = (form: HTMLFormElement) =>
    start(async () => {
      const r = await fn(new FormData(form));
      setState(r);
      if (r?.ok) form.reset();
    });
  return [state, save, pending] as const;
}

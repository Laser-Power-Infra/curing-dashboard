"use client";
// Inline auto-save for the tracker's manual columns: on change for Reason, on blur for text.
import { useState, useTransition } from "react";
import { inputClass } from "@/components/ui";
import { FormMessage, type ActionState } from "@/components/ui/client";
import { saveTrackerField } from "@/actions/tracker";
import { REASONS, type TrackerField } from "@/lib/tracker-reasons";

export function TrackerEdit({ id, field, value, label }: { id: string; field: TrackerField; value: string; label: string }) {
  const [saved, setSaved] = useState(value);
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();

  const save = (raw: string) => {
    const v = raw.trim();
    if (v === saved) return;
    start(async () => {
      let res: ActionState;
      try {
        res = await saveTrackerField(id, field, v);
      } catch {
        res = { ok: false, message: "Not saved. Check the connection and try again." };
      }
      if (res?.ok) setSaved(v);
      setState(res);
    });
  };

  return (
    <div className="min-w-40">
      {field === "reason" ? (
        <select aria-label={label} defaultValue={value} onChange={(e) => save(e.target.value)} className={inputClass}>
          <option value="">–</option>
          {Object.entries(REASONS).map(([k, text]) => (
            <option key={k} value={k}>{text}</option>
          ))}
        </select>
      ) : (
        <input aria-label={label} defaultValue={value} maxLength={500} onBlur={(e) => save(e.target.value)} className={inputClass} />
      )}
      {pending ? <p className="text-sm text-slate-600">Saving…</p> : <FormMessage state={state} />}
    </div>
  );
}

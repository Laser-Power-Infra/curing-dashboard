"use client";
import { useState } from "react";
import { Banner, Button, Field, Input, Textarea } from "@/components/ui";
import { FormMessage } from "@/components/ui/client";
import { fmtDuration, parseIstInput } from "@/lib/format";
import { useSave } from "../../use-save";
import { endCuring } from "../../actions";

const RADIO = "flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded-md border border-slate-300 bg-white px-4 text-base font-medium has-[:checked]:border-blue-700 has-[:checked]:bg-blue-50";
const hrs = (n: number) => `${+n.toFixed(2)} h`;

export function EndCuringForm({ id, startMs, plannedHrs, now }: { id: string; startMs: number; plannedHrs: number | null; now: string }) {
  const [state, save, pending] = useSave(endCuring);
  const err = state?.fieldErrors ?? {};
  const [end, setEnd] = useState(now);
  const [visual, setVisual] = useState("");

  const endAt = parseIstInput(end);
  const actual = endAt ? (endAt.getTime() - startMs) / 3_600_000 : null;
  const beforeStart = actual != null && actual <= 0;
  const short = actual != null && !beforeStart && plannedHrs != null && actual < plannedHrs;

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); save(e.currentTarget); }} className="max-w-xl space-y-4">
      <input type="hidden" name="id" value={id} />
      <Field id="curingEndAt" label="End time" error={beforeStart ? "End time is before start time" : err.curingEndAt}>
        <Input id="curingEndAt" name="curingEndAt" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
      </Field>

      {actual != null && !beforeStart && (
        <p className="text-sm text-slate-800" aria-live="polite">
          Actual <strong>{fmtDuration(actual)}</strong>
          {plannedHrs != null ? <> · Deviation <strong>{fmtDuration(actual - plannedHrs)}</strong></> : " · No approved recipe, so the time cannot be checked"}
        </p>
      )}
      {(short || err.confirmUnder) && (
        <Banner>
          <p className="font-medium">
            {short && actual != null && plannedHrs != null
              ? `Actual ${hrs(actual)} is less than approved ${hrs(plannedHrs)} – this will be marked Under-cured`
              : err.confirmUnder}
          </p>
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3">
            <input type="checkbox" name="confirmUnder" className="size-5" />
            Yes, save this drum as Under-cured
          </label>
        </Banner>
      )}

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-800">Visual check</legend>
        <div className="flex gap-3">
          <label className={RADIO}><input type="radio" name="visualCheck" value="OK" className="size-5" onChange={() => setVisual("OK")} />OK</label>
          <label className={RADIO}><input type="radio" name="visualCheck" value="NOT_OK" className="size-5" onChange={() => setVisual("NOT_OK")} />Not OK</label>
        </div>
        {err.visualCheck && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{err.visualCheck}</p>}
      </fieldset>
      {visual === "NOT_OK" && (
        <Field id="visualNote" label="What is wrong?" error={err.visualNote}>
          <Textarea id="visualNote" name="visualNote" />
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || beforeStart}>{pending ? "Saving…" : "End curing"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

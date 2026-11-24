"use client";
import { useRef } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { FormMessage } from "@/components/ui/client";
import { useSave } from "../../curing/use-save";
import { createTest } from "../actions";

const RADIO = "flex min-h-14 flex-1 cursor-pointer items-center gap-3 rounded-md border border-slate-300 bg-white px-4 text-lg font-semibold";
const READINGS = [
  ["gaugeLengthMm", "Gauge length (mm)"],
  ["lengthUnderLoadMm", "Length under load (mm)"],
  ["lengthAfterCoolingMm", "Length after cooling (mm)"],
];

export function TestForm({ curingLogId, drumNo, now }: { curingLogId: string; drumNo: string; now: string }) {
  const [state, save, pending] = useSave(createTest);
  const err = state?.fieldErrors ?? {};
  const form = useRef<HTMLFormElement>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const number = { type: "number", inputMode: "decimal", step: "any" } as const;

  return (
    <form
      ref={form}
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (new FormData(e.currentTarget).get("result") === "FAIL") confirm.current?.showModal();
        else save(e.currentTarget);
      }}
    >
      <input type="hidden" name="curingLogId" value={curingLogId} />
      <div className="grid grid-cols-2 gap-3">
        <Field id="sampleEnd" label="Sample end">
          <Select id="sampleEnd" name="sampleEnd" defaultValue="">
            <option value="">Not noted</option>
            <option>Inner end</option>
            <option>Outer end</option>
          </Select>
        </Field>
        <Field id="testType" label="Test type">
          <Input id="testType" name="testType" defaultValue="Hot set" />
        </Field>
        {READINGS.map(([k, label]) => (
          <Field key={k} id={k} label={label} error={err[k]}>
            <Input id={k} name={k} {...number} />
          </Field>
        ))}
        <Field id="hotSetPct" label="Hot set %" hint="For reference only" error={err.hotSetPct}>
          <Input id="hotSetPct" name="hotSetPct" {...number} />
        </Field>
        <Field id="permanentSetPct" label="Permanent set %" hint="For reference only" error={err.permanentSetPct}>
          <Input id="permanentSetPct" name="permanentSetPct" {...number} />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-800">Result</legend>
        <div className="flex gap-3">
          <label className={`${RADIO} has-[:checked]:border-green-700 has-[:checked]:bg-green-50`}>
            <input type="radio" name="result" value="PASS" className="size-5" />Pass
          </label>
          <label className={`${RADIO} has-[:checked]:border-red-700 has-[:checked]:bg-red-50`}>
            <input type="radio" name="result" value="FAIL" className="size-5" />Fail
          </label>
        </div>
        {err.result && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{err.result}</p>}
      </fieldset>

      <Field id="testedAt" label="Tested at" error={err.testedAt}>
        <Input id="testedAt" name="testedAt" type="datetime-local" defaultValue={now} />
      </Field>
      <Field id="remarks" label="Remarks (optional)">
        <Textarea id="remarks" name="remarks" />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : "Save result"}</Button>
        <FormMessage state={state} />
      </div>

      <dialog ref={confirm} aria-labelledby="fail-title" className="m-auto w-[min(92vw,24rem)] rounded-lg p-5 backdrop:bg-black/40">
        <h2 id="fail-title" className="text-base font-semibold text-slate-900">Save Fail for drum {drumNo}?</h2>
        <p className="mt-1 text-sm text-slate-700">This drum will be put on hold. It cannot be sent until it is re-cured and passes.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => confirm.current?.close()}>Go back</Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              confirm.current?.close();
              if (form.current) save(form.current);
            }}
          >
            Yes, save Fail
          </Button>
        </div>
      </dialog>
    </form>
  );
}

"use client";
import Link from "next/link";
import { Button, Field, Input, Select } from "@/components/ui";
import { FormMessage } from "@/components/ui/client";
import { useSave } from "@/hooks/use-save";
import { createDrum, setUnloadTime } from "@/actions/unload";

export function NewDrumForm({ lines, products, now }: { lines: { id: string; name: string }[]; products: string[]; now: string }) {
  const [state, save, pending] = useSave(createDrum);
  const err = state?.fieldErrors ?? {};
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); save(e.currentTarget); }} className="grid gap-3 sm:grid-cols-2">
      <Field id="gridEntryId" label="Grid entry ID" error={err.gridEntryId}>
        <Input id="gridEntryId" name="gridEntryId" inputMode="numeric" autoComplete="off" />
      </Field>
      <Field id="lineId" label="Line" error={err.lineId}>
        <Select id="lineId" name="lineId" defaultValue={lines.length === 1 ? lines[0].id : ""}>
          <option value="">Choose line</option>
          {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </Field>
      <Field id="unloadedAt" label="Unload date and time" error={err.unloadedAt}>
        <Input id="unloadedAt" name="unloadedAt" type="datetime-local" defaultValue={now} />
      </Field>
      <Field id="drumNo" label="Drum no" error={err.drumNo}>
        <Input id="drumNo" name="drumNo" autoComplete="off" />
      </Field>
      <Field id="coreItem" label="Core item" hint="Start typing and pick from the list" error={err.coreItem}>
        <Input id="coreItem" name="coreItem" list="core-items" autoComplete="off" />
        <datalist id="core-items">{products.map((p) => <option key={p} value={p} />)}</datalist>
      </Field>
      <Field id="lengthM" label="Length (m)" error={err.lengthM}>
        <Input id="lengthM" name="lengthM" type="number" inputMode="decimal" min="0" step="any" />
      </Field>
      <Field id="drumSize" label="Drum size">
        <Input id="drumSize" name="drumSize" autoComplete="off" />
      </Field>
      <Field id="prodOrders" label="Prod orders" hint="More than one? Separate with commas">
        <Input id="prodOrders" name="prodOrders" autoComplete="off" />
      </Field>
      <Field id="mcNo" label="MC No (optional)">
        <Input id="mcNo" name="mcNo" autoComplete="off" />
      </Field>
      <Field id="party" label="Party (optional)">
        <Input id="party" name="party" autoComplete="off" />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button disabled={pending}>{pending ? "Saving…" : "Save drum"}</Button>
        <FormMessage state={state} />
        {state?.duplicateId && <Link href={`/drums/${state.duplicateId}`} className="text-sm font-medium text-blue-700 underline">Open that drum</Link>}
      </div>
    </form>
  );
}

export function SetTimeForm({ drumId, label }: { drumId: string; label: string }) {
  const [state, save, pending] = useSave(setUnloadTime);
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(e.currentTarget); }} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="drumId" value={drumId} />
      <Input name="time" type="time" required aria-label={label} className="w-32!" />
      <Button variant="secondary" disabled={pending}>{pending ? "Saving…" : "Set time"}</Button>
      <FormMessage state={state} />
    </form>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Banner, Button, Chip, Field, Input, Select, Textarea } from "@/components/ui";
import { FormMessage } from "@/components/ui/client";
import { fmtDateTime, fmtDuration, parseIstInput } from "@/lib/format";
import { useSave } from "../use-save";
import { createCuring, lookupRecipe } from "../actions";

type DrumRow = { id: string; drumNo: string; line: string; unload: string; item: string; length: string; gridEntryId: string; productId: string | null; recure: boolean };
type Recipe = Awaited<ReturnType<typeof lookupRecipe>>;

export function NewCuringForm({ drums, initialDrumId, units, compounds, now }: {
  drums: DrumRow[];
  initialDrumId: string;
  units: { id: string; name: string }[];
  compounds: string[];
  now: string;
}) {
  const [state, save, pending] = useSave(createCuring);
  const err = state?.fieldErrors ?? {};
  const [q, setQ] = useState("");
  const [drumId, setDrumId] = useState(initialDrumId);
  const [compound, setCompound] = useState("");
  const [start, setStart] = useState(now);
  const [looked, setLooked] = useState<{ key: string; recipe: Recipe } | null>(null);

  const drum = drums.find((d) => d.id === drumId);
  const productId = drum?.productId;
  const key = `${compound.trim()}|${productId}`;
  useEffect(() => {
    if (!compound.trim() || !productId) return;
    const t = setTimeout(() => lookupRecipe(compound, productId).then((recipe) => setLooked({ key, recipe })), 300);
    return () => clearTimeout(t);
  }, [compound, productId, key]);
  // undefined = nothing to show yet; null = no approved recipe
  const recipe = !drum || !compound.trim() ? undefined : !productId ? null : looked?.key === key ? looked.recipe : undefined;

  const startAt = parseIstInput(start);
  const endAt = recipe && startAt ? new Date(startAt.getTime() + recipe.approvedCuringHrs * 3_600_000) : null;
  const needle = q.trim().toLowerCase();
  const shown = drums.filter((d) => d.id === drumId || !needle || `${d.drumNo} ${d.gridEntryId} ${d.item} ${d.line}`.toLowerCase().includes(needle));

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); save(e.currentTarget); }} className="max-w-2xl space-y-4">
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-800">Drum – oldest unload first</legend>
        <Input aria-label="Find a drum by drum no, Grid ID or item" type="search" placeholder="Find drum no, Grid ID or item" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
          {shown.map((d) => (
            <label key={d.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-slate-300 bg-white p-3 text-sm has-[:checked]:border-blue-700 has-[:checked]:bg-blue-50">
              <input type="radio" name="drumId" value={d.id} checked={d.id === drumId} onChange={() => setDrumId(d.id)} className="mt-0.5 size-5" />
              <span>
                <span className="font-semibold text-slate-900">Drum {d.drumNo}</span> · {d.line} · {d.unload} {d.recure && <Chip tone="red">Re-cure</Chip>}
                <span className="block text-slate-600">{d.item} · {d.length} · Grid ID {d.gridEntryId}</span>
              </span>
            </label>
          ))}
        </div>
        {err.drumId && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{err.drumId}</p>}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="curingUnitId" label="Tank / chamber" error={err.curingUnitId}>
          <Select id="curingUnitId" name="curingUnitId" defaultValue="">
            <option value="">Choose tank / chamber</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
        <Field id="xlpeCompound" label="XLPE compound" hint="Start typing and pick from the list" error={err.xlpeCompound}>
          <Input id="xlpeCompound" name="xlpeCompound" list="compounds" autoComplete="off" value={compound} onChange={(e) => setCompound(e.target.value)} />
          <datalist id="compounds">{compounds.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field id="lotNo" label="Lot no">
          <Input id="lotNo" name="lotNo" autoComplete="off" />
        </Field>
        <Field id="curingStartAt" label="Start time" error={err.curingStartAt}>
          <Input id="curingStartAt" name="curingStartAt" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
      </div>

      {recipe && (
        <Banner tone="blue">
          Approved curing time {fmtDuration(recipe.approvedCuringHrs)}
          {endAt && <> · Expected end {fmtDateTime(endAt)} · Test due {fmtDateTime(new Date(endAt.getTime() + recipe.waitBeforeTestHrs * 3_600_000))}</>}
        </Banner>
      )}
      {recipe === null && <Banner>No approved recipe for this compound and product – Mukesh will be alerted</Banner>}

      <Field id="remarks" label="Remarks (optional)">
        <Textarea id="remarks" name="remarks" />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : "Start curing"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

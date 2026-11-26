// Boiler Log: shift grid + quick entry (guide 6.7, 3.4, rule 9).
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, viewer } from "@/lib/auth";
import { fmtDateOnly, fmtDateTime, istDay, parseDateOnly } from "@/lib/format";
import { Banner, Card, EmptyState, Field, Input, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { saveReading } from "@/actions/boiler";
import { currentShift, shiftWindow } from "@/lib/shifts";
import { PAGE_SIZE, facets, pageOf, searchOf, type SP } from "@/lib/table";
import type { Prisma } from "@/generated/prisma/client";

const DAYS = 14;

/** Every row of the plant's water tank log (Curing Sheet › Boiler Temp Log), newest first. */
async function TankLog({ sp }: { sp: SP }) {
  const q = searchOf(sp);
  const page = pageOf(sp);
  const base: Prisma.BoilerTempLogWhereInput = q
    ? { OR: (["operator", "remarks", "shift", "fuel"] as const).map((k) => ({ [k]: { contains: q, mode: "insensitive" } })) }
    : {};
  const head = await facets(
    sp,
    // "shift" in the URL already means the shift picked in the entry form above.
    { shift: { header: "Shift", param: "logShift" }, fuel: { header: "Boiler on" }, operator: { header: "Operator" } },
    async (field, others) => (await prisma.boilerTempLog.groupBy({ by: [field], where: { AND: [base, ...(others as Prisma.BoilerTempLogWhereInput[])] }, _count: { _all: true } })).map((g) => ({ value: g[field], count: g._count._all })),
  );
  const where: Prisma.BoilerTempLogWhereInput = { AND: [base, ...(head.where as Prisma.BoilerTempLogWhereInput[])] };
  const [total, rows] = await Promise.all([
    prisma.boilerTempLog.count({ where }),
    prisma.boilerTempLog.findMany({ where, orderBy: [{ date: "desc" }, { time: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const t = (v: unknown) => (v == null ? "–" : `${Number(v)}`);
  return (
    <section aria-labelledby="tank-log" className="mt-8">
      <h2 id="tank-log" className="mb-1 text-base font-semibold text-slate-900">Boiler temp log</h2>
      <p className="mb-2 text-sm text-slate-600">Water tank temperatures as logged by the boiler operators. Newest first.</p>
      <Table server={{ total, page, pageSize: PAGE_SIZE, q, filters: head.filters }}>
          <thead>
            <tr><th>Date</th><th>Time</th><th>Shift</th><th>Tank 1 °C</th><th>Tank 2 °C</th><th>Tank 3 °C</th><th>Boiler on</th><th>Operator</th><th>Remarks</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{fmtDateOnly(r.date)}</td>
                <td className="whitespace-nowrap tabular-nums">{r.time ?? "–"}</td>
                <td>{r.shift ?? "–"}</td>
                <td className="tabular-nums">{t(r.tank1C)}</td>
                <td className="tabular-nums">{t(r.tank2C)}</td>
                <td className="tabular-nums">{t(r.tank3C)}</td>
                <td>{r.fuel ?? "–"}</td>
                <td className="whitespace-nowrap">{r.operator ?? "–"}</td>
                <td>{r.remarks ?? ""}</td>
              </tr>
            ))}
          </tbody>
      </Table>
    </section>
  );
}

export default async function BoilerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([viewer(), searchParams]);
  const now = new Date();
  const today = istDay(now);
  const days = Array.from({ length: DAYS }, (_, i) => new Date(today.getTime() - i * 86_400_000));

  const [shifts, boilers, readings] = await Promise.all([
    prisma.shiftDef.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.boiler.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.boilerReading.findMany({ where: { date: { gte: days[DAYS - 1] } } }),
  ]);
  if (!shifts.length || !boilers.length) {
    return (
      <>
        <PageHeader title="Boiler log" />
        <EmptyState>No boilers or shifts are set up yet. Add them in Settings.</EmptyState>
        <TankLog sp={sp} />
      </>
    );
  }

  const cellKey = (boilerId: string, day: Date, shiftId: string) => `${boilerId}|${day.toISOString().slice(0, 10)}|${shiftId}`;
  const byCell = new Map(readings.map((r) => [cellKey(r.boilerId, r.date, r.shiftId), r]));
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const running = currentShift(now, shifts);
  const date = parseDateOnly(one(sp.date)) ?? running?.day ?? today;
  const shiftId = shifts.find((s) => s.id === one(sp.shift))?.id ?? running?.shift.id ?? shifts[0].id;
  const boilerId = boilers.find((b) => b.id === one(sp.boiler))?.id ?? boilers[0].id;
  const dateStr = date.toISOString().slice(0, 10);
  const existing = byCell.get(cellKey(boilerId, date, shiftId));
  const reading = (r: { temperatureC: unknown; pressureBar: unknown }) =>
    [r.temperatureC != null && `${Number(r.temperatureC)} °C`, r.pressureBar != null && `${Number(r.pressureBar)} bar`].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader title="Boiler log" sub="One reading for each boiler in each shift. A shift with no reading turns red once the shift has ended." />
      {shifts.some((s) => !s.confirmed) && <Banner>Shift timings are not confirmed by the plant yet. They can be changed in Settings.</Banner>}

      {can(user, "boilerEntry") && (
        <Card title="Enter a reading" className="mb-6">
          <div id="entry" className="scroll-mt-32">
            {/* Remount when another cell is tapped so the fields take that cell's values. */}
            <ActionForm key={`${dateStr}|${shiftId}|${boilerId}`} action={saveReading} submit={existing ? "Update reading" : "Save reading"}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="date" label="Date">
                  <Input id="date" name="date" type="date" required max={today.toISOString().slice(0, 10)} defaultValue={dateStr} />
                </Field>
                <Field id="shiftId" label="Shift">
                  <Select id="shiftId" name="shiftId" required defaultValue={shiftId}>
                    {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
                  </Select>
                </Field>
                <Field id="boilerId" label="Boiler">
                  <Select id="boilerId" name="boilerId" required defaultValue={boilerId}>
                    {boilers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field id="temperatureC" label="Temperature (°C)">
                  <Input id="temperatureC" name="temperatureC" type="number" inputMode="decimal" step="0.01" min="0" max="999" defaultValue={existing?.temperatureC?.toString() ?? ""} />
                </Field>
                <Field id="pressureBar" label="Pressure (bar)">
                  <Input id="pressureBar" name="pressureBar" type="number" inputMode="decimal" step="0.01" min="0" max="999" defaultValue={existing?.pressureBar?.toString() ?? ""} />
                </Field>
                <Field id="remarks" label="Remarks">
                  <Textarea id="remarks" name="remarks" defaultValue={existing?.remarks ?? ""} />
                </Field>
              </div>
              {existing && (
                <p className="mt-2 text-sm text-amber-900">
                  A reading for this boiler and shift was entered {fmtDateTime(existing.recordedAt)} by {existing.recordedBy ?? "–"}. Saving will replace it; the old values are kept in the history.
                </p>
              )}
            </ActionForm>
          </div>
        </Card>
      )}

      <div className="grid gap-6">
        {boilers.map((b) => (
          <section key={b.id}>
            <h2 className="mb-2 text-base font-semibold text-slate-900">{b.name} – last {DAYS} days</h2>
            <Table>
              <thead>
                <tr><th>Date</th>{shifts.map((s) => <th key={s.id}>{s.name}</th>)}</tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.getTime()}>
                    <td className="whitespace-nowrap">{fmtDateOnly(day)}</td>
                    {shifts.map((s) => {
                      const r = byCell.get(cellKey(b.id, day, s.id));
                      const w = shiftWindow(day, s);
                      const [tone, text] = r
                        ? ["border-green-200 bg-green-50 text-green-800", `✓ ${reading(r) || "Entered"}`]
                        : w.end <= now
                          ? ["border-red-200 bg-red-50 text-red-800 font-medium", "Missing"]
                          : ["border-slate-200 bg-white text-slate-600", w.start <= now ? "Due this shift" : "Not due yet"];
                      return (
                        <td key={s.id}>
                          <Link
                            href={`/boiler?date=${day.toISOString().slice(0, 10)}&shift=${s.id}&boiler=${b.id}#entry`}
                            className={`flex min-h-11 min-w-28 items-center rounded-md border px-2 text-xs whitespace-nowrap ${tone}`}
                          >
                            {text}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        ))}
      </div>
      <TankLog sp={sp} />
    </>
  );
}

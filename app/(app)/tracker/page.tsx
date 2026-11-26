// Missing Drum Tracker (guide 6.2, 3.8). Auto columns are read-only; Reason / Remarks / MD Remarks save inline.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { viewer } from "@/lib/auth";
import { fmtDateOnly, fmtDateTime, fmtDuration, fmtM, hoursBetween, parseDateOnly } from "@/lib/format";
import { Button, Chip, Field, Input, PageHeader, Select, StatusChip, Table } from "@/components/ui";
import { one, qs } from "@/components/drums/shared";
import { PAGE_SIZE, pageOf, searchOf, type SP } from "@/lib/table";
import { TrackerEdit } from "@/components/tracker/edit";
import { REASONS, mayEditTracker, trackId, type TrackerField } from "@/lib/tracker";

const TABS: { key: string; label: string; where: Prisma.MissingDrumTrackerWhereInput }[] = [
  { key: "open", label: "Open (Missing)", where: { status: "MISSING" } },
  { key: "late", label: "Late", where: { status: "LATE" } },
  { key: "data-error", label: "Data error", where: { status: "DATA_ERROR" } },
  { key: "closed", label: "Closed", where: { closedAt: { not: null } } },
  { key: "all", label: "All", where: {} },
];

export default async function TrackerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await viewer();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === one(sp.tab)) ?? TABS[0];
  const line = one(sp.line);
  const from = one(sp.from);
  const to = one(sp.to);
  const reasonStr = one(sp.reason);
  const reason = reasonStr && reasonStr in REASONS ? (reasonStr as keyof typeof REASONS) : undefined;
  const levelStr = one(sp.level);
  const level = levelStr && /^\d+$/.test(levelStr) ? Number(levelStr) : undefined;
  const page = pageOf(sp);
  const q = searchOf(sp);
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  const filters = { line, from: fromDate ? from : undefined, to: toDate ? to : undefined, reason, level };

  const base: Prisma.MissingDrumTrackerWhereInput = {
    drum: {
      isCuringItem: true,
      line: { inScope: true, ...(line && { code: line }) },
      ...((fromDate || toDate) && { unloadDate: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } }),
    },
    ...(reason && { reason }),
    ...(level !== undefined && { escalationLevel: level }),
    ...(q && {
      OR: [
        { drum: { drumNo: { contains: q, mode: "insensitive" } } },
        { drum: { gridEntryId: { contains: q, mode: "insensitive" } } },
        { drum: { coreItem: { contains: q, mode: "insensitive" } } },
        { remarks: { contains: q, mode: "insensitive" } },
        { mdRemarks: { contains: q, mode: "insensitive" } },
      ],
    }),
  };
  const where = { ...base, ...tab.where };

  const [lines, counts, rows] = await Promise.all([
    prisma.line.findMany({ where: { inScope: true }, orderBy: { name: "asc" } }),
    Promise.all(TABS.map((t) => prisma.missingDrumTracker.count({ where: { ...base, ...t.where } }))),
    prisma.missingDrumTracker.findMany({
      where,
      // Open rows: most overdue first.
      orderBy: tab.key === "open" ? [{ drum: { unloadedAt: "asc" } }, { trackNo: "asc" }] : { trackNo: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { drum: { include: { line: true } }, curingLog: { select: { lotNo: true, cycleNo: true } } },
    }),
  ]);
  const total = counts[TABS.indexOf(tab)];
  const now = new Date();

  const manual = (row: (typeof rows)[number], field: TrackerField, label: string) => {
    const value = row[field] ?? "";
    if (!mayEditTracker(user, field, row.closedAt != null)) return field === "reason" && row.reason ? REASONS[row.reason] : value || "–";
    return <TrackerEdit id={row.id} field={field} value={value} label={`${label} for ${trackId(row.trackNo)}`} />;
  };

  return (
    <>
      <PageHeader title="Missing Drum Tracker" sub="Permanent record. Rows are closed, never deleted." />

      <nav aria-label="Status" className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map((t, i) => (
          <Link
            key={t.key}
            href={`/tracker${qs({ ...filters, tab: t.key })}`}
            aria-current={t === tab ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-700 ${
              t === tab ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {t.label} <span className="tabular-nums text-slate-600">{counts[i]}</span>
          </Link>
        ))}
      </nav>

      <form method="get" className="mb-4 grid grid-cols-2 items-end gap-3 md:grid-cols-6">
        <input type="hidden" name="tab" value={tab.key} />
        {q && <input type="hidden" name="q" value={q} />}
        <Field id="f-line" label="Line">
          <Select id="f-line" name="line" defaultValue={line ?? ""}>
            <option value="">All lines</option>
            {lines.map((l) => (
              <option key={l.id} value={l.code}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Field id="f-reason" label="Reason">
          <Select id="f-reason" name="reason" defaultValue={reason ?? ""}>
            <option value="">Any</option>
            {Object.entries(REASONS).map(([k, text]) => (
              <option key={k} value={k}>{text}</option>
            ))}
          </Select>
        </Field>
        <Field id="f-from" label="Unloaded from">
          <Input id="f-from" name="from" type="date" defaultValue={filters.from} />
        </Field>
        <Field id="f-to" label="Unloaded to">
          <Input id="f-to" name="to" type="date" defaultValue={filters.to} />
        </Field>
        <Field id="f-level" label="Escalation level">
          <Input id="f-level" name="level" type="number" min={0} inputMode="numeric" defaultValue={level} />
        </Field>
        <Button type="submit" variant="secondary">Show</Button>
      </form>

      <Table server={{ total, page, pageSize: PAGE_SIZE, q, filters: {} }}>
          <thead>
            <tr>
              <th>Track ID</th>
              <th>Grid ID</th>
              <th>Line</th>
              <th>Drum no</th>
              <th>Item</th>
              <th>Prod order</th>
              <th>Length</th>
              <th>Unloaded at</th>
              <th>Hours since unload</th>
              <th>Status</th>
              <th>Curing row</th>
              <th>Curing start</th>
              <th>Hours late</th>
              <th>Level</th>
              <th>Last alert</th>
              <th>Closed on</th>
              <th>Reason</th>
              <th>Remarks</th>
              <th>MD Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/drums/${r.drumId}`} className="inline-flex min-h-11 items-center font-medium whitespace-nowrap text-blue-700 underline">
                    {trackId(r.trackNo)}
                  </Link>
                </td>
                <td>{r.drum.gridEntryId}</td>
                <td className="whitespace-nowrap">{r.drum.line.name}</td>
                <td className="font-medium">{r.drum.drumNo}</td>
                <td>{r.drum.coreItem}</td>
                <td>{r.drum.prodOrders.join(", ") || "–"}</td>
                <td className="whitespace-nowrap tabular-nums">{fmtM(r.drum.lengthM)}</td>
                <td className="whitespace-nowrap">{r.drum.unloadedAt ? fmtDateTime(r.drum.unloadedAt) : fmtDateOnly(r.drum.unloadDate)}</td>
                <td className="whitespace-nowrap tabular-nums">
                  {!r.drum.unloadedAt ? <Chip>time unknown</Chip> : r.closedAt ? "–" : fmtDuration(hoursBetween(r.drum.unloadedAt, now))}
                </td>
                <td><StatusChip status={r.status} /></td>
                <td className="whitespace-nowrap">{r.curingLog ? (r.curingLog.lotNo ?? `Cycle ${r.curingLog.cycleNo}`) : "–"}</td>
                <td className="whitespace-nowrap">{fmtDateTime(r.curingStartAt)}</td>
                <td className="whitespace-nowrap tabular-nums">{fmtDuration(r.hoursLate)}</td>
                <td className="tabular-nums">{r.escalationLevel}</td>
                <td className="whitespace-nowrap">{fmtDateTime(r.lastAlertAt)}</td>
                <td className="whitespace-nowrap">{fmtDateTime(r.closedAt)}</td>
                <td>{manual(r, "reason", "Reason")}</td>
                <td>{manual(r, "remarks", "Remarks")}</td>
                <td>{manual(r, "mdRemarks", "MD Remarks")}</td>
              </tr>
            ))}
          </tbody>
      </Table>
    </>
  );
}

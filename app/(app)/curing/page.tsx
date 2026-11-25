import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, viewer } from "@/lib/auth";
import { fmtDateTime, fmtDuration, istDayStart, parseDateOnly } from "@/lib/format";
import { Button, EmptyState, Field, Input, LinkButton, PageHeader, STATUS, Select, StatusChip, Table } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";
import type { DrumStatus } from "@/generated/prisma/enums";

const PAGE = 50;
const STATUSES: DrumStatus[] = ["IN_CURING", "AWAITING_TEST", "TEST_OVERDUE", "FAILED", "PASSED", "REQUISITION_RAISED", "SENT"];

export default async function CuringPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await viewer();
  const mayWrite = can(user, "curingEntry");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? sp[k] : "");
  const line = one("line");
  const status = STATUSES.find((s) => s === one("status"));
  const from = parseDateOnly(one("from"));
  const to = parseDateOnly(one("to"));
  const page = Math.max(1, Math.floor(Number(one("page"))) || 1);

  const where: Prisma.CuringLogWhereInput = {};
  if (line) where.drum = { lineId: line };
  if (status) where.lotStatus = status;
  if (from || to)
    where.curingStartAt = {
      gte: from ? istDayStart(from) : undefined,
      lt: to ? new Date(istDayStart(to).getTime() + 86_400_000) : undefined,
    };

  const [lines, total, rows] = await Promise.all([
    prisma.line.findMany({ where: { inScope: true }, orderBy: { name: "asc" } }),
    prisma.curingLog.count({ where }),
    prisma.curingLog.findMany({ where, include: { curingUnit: true }, orderBy: { curingStartAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
  ]);
  const pageHref = (p: number) =>
    `/curing?${new URLSearchParams({ line, status: status ?? "", from: one("from"), to: one("to"), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Curing log" sub={`${total} ${total === 1 ? "entry" : "entries"}`}>
        {mayWrite && <LinkButton href="/curing/new">New curing entry</LinkButton>}
      </PageHeader>

      <form method="get" className="mb-4 grid grid-cols-2 items-end gap-3 sm:grid-cols-5">
        <Field id="line" label="Line">
          <Select id="line" name="line" defaultValue={line}>
            <option value="">All lines</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field id="status" label="Status">
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </Select>
        </Field>
        <Field id="from" label="Started from">
          <Input id="from" name="from" type="date" defaultValue={one("from")} />
        </Field>
        <Field id="to" label="Started to">
          <Input id="to" name="to" type="date" defaultValue={one("to")} />
        </Field>
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <Button variant="secondary">Apply</Button>
          <LinkButton variant="secondary" href="/curing">Clear</LinkButton>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState>No curing entries for these filters</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Lot no</th><th>Drum no</th><th>Cycle</th><th>Tank</th><th>Compound</th><th>Start</th><th>End</th>
              <th>Planned / actual</th><th>Deviation</th><th>Time check</th><th>Test due</th><th>Result</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.lotNo ?? "–"}</td>
                <td>
                  {r.drumId ? <Link href={`/drums/${r.drumId}`} className="font-medium text-blue-700 underline">{r.coreDrumNo}</Link> : r.coreDrumNo}
                </td>
                <td>{r.cycleNo}</td>
                <td className="whitespace-nowrap">{r.curingUnit?.name ?? r.chamberTankText ?? "–"}</td>
                <td>{r.xlpeCompound ?? "–"}</td>
                <td className="whitespace-nowrap">{fmtDateTime(r.curingStartAt)}</td>
                <td className="whitespace-nowrap">{fmtDateTime(r.curingEndAt)}</td>
                <td className="whitespace-nowrap">{fmtDuration(r.plannedCuringHrs)} / {fmtDuration(r.actualCuringHrs)}</td>
                <td className="whitespace-nowrap">{fmtDuration(r.hoursDeviation)}</td>
                <td><StatusChip status={r.timeCheck} /></td>
                <td className="whitespace-nowrap">{fmtDateTime(r.testDueAt)}</td>
                <td><StatusChip status={r.testResult} /></td>
                <td><StatusChip status={r.lotStatus} /></td>
                <td>{mayWrite && !r.curingEndAt && <LinkButton variant="secondary" href={`/curing/${r.id}/end`} className="whitespace-nowrap">End curing</LinkButton>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {total > PAGE && (
        <nav aria-label="Pages" className="mt-4 flex items-center gap-3 text-sm text-slate-600">
          {page > 1 && <LinkButton variant="secondary" href={pageHref(page - 1)}>Previous</LinkButton>}
          <span>Page {page} of {Math.ceil(total / PAGE)}</span>
          {page * PAGE < total && <LinkButton variant="secondary" href={pageHref(page + 1)}>Next</LinkButton>}
        </nav>
      )}
    </>
  );
}

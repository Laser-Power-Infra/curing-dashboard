import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, viewer } from "@/lib/auth";
import { fmtDateTime, fmtDuration, istDayStart, parseDateOnly } from "@/lib/format";
import { Button, Field, Input, LinkButton, PageHeader, STATUS, Select, StatusChip, Table } from "@/components/ui";
import { PAGE_SIZE, facets, pageOf, searchOf } from "@/lib/table";
import { DrumStatus, TestResult, TimeCheck } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export default async function CuringPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await viewer();
  const mayWrite = can(user, "curingEntry");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? sp[k] : "");
  const line = one("line");
  const from = parseDateOnly(one("from"));
  const to = parseDateOnly(one("to"));
  const q = searchOf(sp);
  const page = pageOf(sp);

  // Form filters and the search box. The column-header filters are added on top (AND).
  const base: Prisma.CuringLogWhereInput = {};
  if (line) base.drum = { lineId: line };
  if (from || to)
    base.curingStartAt = {
      gte: from ? istDayStart(from) : undefined,
      lt: to ? new Date(istDayStart(to).getTime() + 86_400_000) : undefined,
    };
  if (q) base.OR = (["lotNo", "coreDrumNo", "xlpeCompound", "productName", "chamberTankText"] as const).map((k) => ({ [k]: { contains: q, mode: "insensitive" } }));

  const label = (v: string) => STATUS[v]?.label ?? v;
  const head = await facets(
    sp,
    {
      lotNo: { header: "Lot no" },
      coreDrumNo: { header: "Drum no" },
      cycleNo: { header: "Cycle", int: true },
      xlpeCompound: { header: "Compound" },
      timeCheck: { header: "Time check", label, values: Object.keys(TimeCheck) },
      testResult: { header: "Result", label, values: Object.keys(TestResult) },
      lotStatus: { header: "Status", param: "status", label, values: Object.keys(DrumStatus) },
    },
    async (field, others) => (await prisma.curingLog.groupBy({ by: [field], where: { AND: [base, ...(others as Prisma.CuringLogWhereInput[])] }, _count: { _all: true } })).map((g) => ({ value: g[field], count: g._count._all })),
  );
  const where: Prisma.CuringLogWhereInput = { AND: [base, ...(head.where as Prisma.CuringLogWhereInput[])] };

  const [lines, total, rows] = await Promise.all([
    prisma.line.findMany({ where: { inScope: true }, orderBy: { name: "asc" } }),
    prisma.curingLog.count({ where }),
    prisma.curingLog.findMany({ where, include: { curingUnit: true }, orderBy: { curingStartAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  return (
    <>
      <PageHeader title="Curing log" sub={`${total} ${total === 1 ? "entry" : "entries"}`}>
        {mayWrite && <LinkButton href="/curing/new">New curing entry</LinkButton>}
      </PageHeader>

      <form method="get" className="mb-4 grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
        <Field id="line" label="Line">
          <Select id="line" name="line" defaultValue={line}>
            <option value="">All lines</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
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

      <Table server={{ total, page, pageSize: PAGE_SIZE, q, filters: head.filters }}>
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
    </>
  );
}

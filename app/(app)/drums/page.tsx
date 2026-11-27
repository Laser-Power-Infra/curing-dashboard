// Drum list – the target of every KPI tile and of the search box in the top bar.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { DrumStatus } from "@/generated/prisma/enums";
import { viewer } from "@/lib/auth";
import { fmtDateOnly, fmtDateTime, fmtM, parseDateOnly } from "@/lib/format";
import { Button, Chip, Field, PageHeader, STATUS, Select, StatusChip, Table } from "@/components/ui";
import { one, sentSince } from "@/components/drums/shared";
import { PAGE_SIZE, facets, many, pageOf, type SP } from "@/lib/table";
import { Item } from "./item";

export default async function DrumsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await viewer();
  const sp = await searchParams;
  const q = one(sp.q);
  const line = one(sp.line);
  const sent = one(sp.sent);
  const time = one(sp.time);
  const dateStr = one(sp.date);
  // Asked for by status (a KPI tile link or the Status column filter).
  const statuses = many(sp.status).filter((s) => s in DrumStatus) as DrumStatus[];
  const page = pageOf(sp);
  const sentFrom = sentSince(sent, new Date());
  const date = parseDateOnly(dateStr);

  // Everything except the column-header filters, which are added on top (AND).
  const base: Prisma.DrumWhereInput = {
    line: { inScope: true, ...(line && { code: line }) },
    // Non-curing items stay out of every list unless searched for or asked for by status.
    ...(!q && !statuses.includes("NOT_CURING_ITEM") && { isCuringItem: true }),
    ...(sentFrom && { curingLogs: { some: { sentDate: { gte: sentFrom } } } }),
    ...(date && { unloadDate: date }),
    ...(time === "unknown" && { unloadedAt: null }),
    ...(q && {
      OR: [
        { drumNo: { contains: q, mode: "insensitive" } },
        { gridEntryId: { contains: q, mode: "insensitive" } },
        { party: { contains: q, mode: "insensitive" } },
        { coreItem: { contains: q, mode: "insensitive" } },
        { curingLogs: { some: { lotNo: { contains: q, mode: "insensitive" } } } },
      ],
    }),
  };

  const head = await facets(
    sp,
    {
      drumNo: { header: "Drum no" },
      party: { header: "Party" },
      coreItem: { header: "Item" },
      status: { header: "Status", label: (v) => STATUS[v]?.label ?? v, values: Object.keys(DrumStatus) },
    },
    async (field, others) => (await prisma.drum.groupBy({ by: [field], where: { AND: [base, ...(others as Prisma.DrumWhereInput[])] }, _count: { _all: true } })).map((g) => ({ value: g[field], count: g._count._all })),
  );
  const where: Prisma.DrumWhereInput = { AND: [base, ...(head.where as Prisma.DrumWhereInput[])] };

  const [lines, total, drums] = await Promise.all([
    prisma.line.findMany({ where: { inScope: true }, orderBy: { name: "asc" } }),
    prisma.drum.count({ where }),
    prisma.drum.findMany({
      where,
      orderBy: [{ unloadDate: "desc" }, { unloadedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { line: true, product: { select: { code: true } }, curingLogs: { orderBy: { cycleNo: "desc" }, take: 1, select: { lotNo: true } } },
    }),
  ]);

  const extra = [
    sentFrom && (sent === "today" ? "sent today" : "sent this week"),
    date && `unloaded ${fmtDateOnly(date)}`,
    time === "unknown" && "unload time unknown",
  ].filter(Boolean);

  return (
    <>
      <PageHeader title="Drums" sub={`${total} drum${total === 1 ? "" : "s"}${extra.length ? ` · ${extra.join(" · ")}` : ""}`} />

      <form method="get" className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-4">
        {q && <input type="hidden" name="q" value={q} />}
        {statuses.map((s) => <input key={s} type="hidden" name="status" value={s} />)}
        <Field id="f-line" label="Line">
          <Select id="f-line" name="line" defaultValue={line ?? ""}>
            <option value="">All lines</option>
            {lines.map((l) => (
              <option key={l.id} value={l.code}>{l.name}</option>
            ))}
          </Select>
        </Field>
        {sentFrom && <input type="hidden" name="sent" value={sent} />}
        {date && <input type="hidden" name="date" value={dateStr} />}
        {time === "unknown" && <input type="hidden" name="time" value="unknown" />}
        <Button type="submit" variant="secondary">Show</Button>
      </form>

      <Table server={{ total, page, pageSize: PAGE_SIZE, q: q ?? "", filters: head.filters }}>
          <thead>
            <tr>
              <th>Grid ID</th>
              <th>Line</th>
              <th>Drum no</th>
              <th>Party</th>
              <th>Item</th>
              <th>Length</th>
              <th>Unloaded</th>
              <th>Status</th>
              <th>Latest lot no</th>
            </tr>
          </thead>
          <tbody>
            {drums.map((d) => (
              <tr key={d.id}>
                <td>{d.gridEntryId}</td>
                <td className="whitespace-nowrap">{d.line.name}</td>
                <td>
                  <Link href={`/drums/${d.id}`} className="inline-flex min-h-11 items-center font-medium text-blue-700 underline">
                    {d.drumNo}
                  </Link>
                </td>
                <td>{d.party ?? "–"}</td>
                <td><Item name={d.coreItem} code={d.product?.code} /></td>
                <td className="whitespace-nowrap tabular-nums">{fmtM(d.lengthM)}</td>
                <td className="whitespace-nowrap">
                  {d.unloadedAt ? fmtDateTime(d.unloadedAt) : <>{fmtDateOnly(d.unloadDate)} <Chip>time unknown</Chip></>}
                </td>
                <td><StatusChip status={d.status} /></td>
                <td>{d.curingLogs[0]?.lotNo ?? "–"}</td>
              </tr>
            ))}
          </tbody>
      </Table>
    </>
  );
}

// Drum list – the target of every KPI tile and of the search box in the top bar.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { DrumStatus } from "@/generated/prisma/enums";
import { viewer } from "@/lib/auth";
import { fmtDateOnly, fmtDateTime, fmtM, parseDateOnly } from "@/lib/format";
import { Button, Chip, EmptyState, Field, Input, PageHeader, STATUS, Select, StatusChip, Table } from "@/components/ui";
import { PAGE_SIZE, Pager, one, pageOf, sentSince, type SP } from "@/components/drums/shared";

export default async function DrumsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await viewer();
  const sp = await searchParams;
  const q = one(sp.q);
  const line = one(sp.line);
  const sent = one(sp.sent);
  const time = one(sp.time);
  const dateStr = one(sp.date);
  const statusStr = one(sp.status);
  const status = statusStr && statusStr in DrumStatus ? (statusStr as DrumStatus) : undefined;
  const page = pageOf(sp.page);
  const sentFrom = sentSince(sent, new Date());
  const date = parseDateOnly(dateStr);

  const where: Prisma.DrumWhereInput = {
    line: { inScope: true, ...(line && { code: line }) },
    // Non-curing items stay out of every list unless searched for or asked for by status.
    ...(!q && status !== "NOT_CURING_ITEM" && { isCuringItem: true }),
    ...(status && { status }),
    ...(sentFrom && { curingLogs: { some: { sentDate: { gte: sentFrom } } } }),
    ...(date && { unloadDate: date }),
    ...(time === "unknown" && { unloadedAt: null }),
    ...(q && {
      OR: [
        { drumNo: { contains: q, mode: "insensitive" } },
        { gridEntryId: { contains: q, mode: "insensitive" } },
        { curingLogs: { some: { lotNo: { contains: q, mode: "insensitive" } } } },
      ],
    }),
  };

  const [lines, total, drums] = await Promise.all([
    prisma.line.findMany({ where: { inScope: true }, orderBy: { name: "asc" } }),
    prisma.drum.count({ where }),
    prisma.drum.findMany({
      where,
      orderBy: [{ unloadDate: "desc" }, { unloadedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { line: true, curingLogs: { orderBy: { cycleNo: "desc" }, take: 1, select: { lotNo: true } } },
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
        <Field id="f-q" label="Drum no, lot no or Grid ID">
          <Input id="f-q" name="q" type="search" defaultValue={q} />
        </Field>
        <Field id="f-status" label="Status">
          <Select id="f-status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {Object.keys(DrumStatus).map((s) => (
              <option key={s} value={s}>{STATUS[s]?.label ?? s}</option>
            ))}
          </Select>
        </Field>
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

      {drums.length === 0 ? (
        <EmptyState>No drums match. <Link href="/drums" className="font-medium text-blue-700 underline">Clear filters</Link></EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Grid ID</th>
              <th>Line</th>
              <th>Drum no</th>
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
                <td>{d.coreItem}</td>
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
      )}
      <Pager path="/drums" params={{ q, status, line, sent: sentFrom ? sent : undefined, date: date ? dateStr : undefined, time: time === "unknown" ? time : undefined }} page={page} total={total} />
    </>
  );
}

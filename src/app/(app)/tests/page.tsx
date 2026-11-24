import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fmtDateTime, fmtM } from "@/lib/format";
import { Chip, EmptyState, LinkButton, PageHeader, StatusChip, Table } from "@/components/ui";

const QUEUE_MAX = 100;

export default async function TestsPage() {
  const user = await requireUser();
  const mayWrite = can(user, "testEntry");
  const [settings, due, recent] = await Promise.all([
    getSettings(),
    prisma.curingLog.findMany({
      where: { curingEndAt: { not: null }, testResult: null, hotSetTests: { none: {} } },
      orderBy: [{ testDueAt: { sort: "asc", nulls: "last" } }, { curingEndAt: "asc" }],
      take: QUEUE_MAX,
    }),
    prisma.hotSetTest.findMany({ include: { curingLog: true }, orderBy: { testedAt: "desc" }, take: 50 }),
  ]);
  const now = new Date();
  const overdueFrom = now.getTime() - settings.testOverdueGraceHours * 3_600_000;

  return (
    <>
      <PageHeader title="Hot set test" sub="Drums out of curing that still need a result, most urgent first" />

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Tests due{due.length === QUEUE_MAX && ` – first ${QUEUE_MAX}`}</h2>
        {due.length === 0 ? (
          <EmptyState>No tests due right now</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><th>Test due</th><th></th><th>Lot no</th><th>Drum no</th><th>Length</th><th>Curing ended</th><th></th></tr>
            </thead>
            <tbody>
              {due.map((r) => {
                const overdue = r.testDueAt != null && r.testDueAt.getTime() < overdueFrom;
                return (
                  <tr key={r.id} className={overdue ? "bg-red-50" : undefined}>
                    <td className="whitespace-nowrap font-medium">{fmtDateTime(r.testDueAt)}</td>
                    <td>
                      {overdue ? <Chip tone="red">Test overdue</Chip>
                        : r.testDueAt && r.testDueAt <= now ? <Chip tone="amber">Due now</Chip>
                        : r.testDueAt ? <Chip>Not due yet</Chip>
                        : <Chip tone="red">No recipe</Chip>}
                    </td>
                    <td>{r.lotNo ?? "–"}</td>
                    <td>{r.drumId ? <Link href={`/drums/${r.drumId}`} className="font-medium text-blue-700 underline">{r.coreDrumNo}</Link> : r.coreDrumNo}</td>
                    <td className="whitespace-nowrap">{fmtM(r.lengthM)}</td>
                    <td className="whitespace-nowrap">{fmtDateTime(r.curingEndAt)}</td>
                    <td>{mayWrite && <LinkButton href={`/tests/new?log=${r.id}`} className="whitespace-nowrap">Enter result</LinkButton>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Recent results</h2>
        {recent.length === 0 ? (
          <EmptyState>No results entered yet</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><th>Tested</th><th>Result</th><th>Lot no</th><th>Drum no</th><th>Sample end</th><th>Test type</th><th>Hot set %</th><th>Permanent set %</th><th>Tested by</th></tr>
            </thead>
            <tbody>
              {recent.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(t.testedAt)}</td>
                  <td><StatusChip status={t.result} /></td>
                  <td>{t.lotNo ?? "–"}</td>
                  <td>{t.drumId ? <Link href={`/drums/${t.drumId}`} className="font-medium text-blue-700 underline">{t.curingLog.coreDrumNo}</Link> : t.curingLog.coreDrumNo}</td>
                  <td>{t.sampleEnd ?? "–"}</td>
                  <td>{t.testType ?? "–"}</td>
                  <td>{t.hotSetPct?.toString() ?? "–"}</td>
                  <td>{t.permanentSetPct?.toString() ?? "–"}</td>
                  <td>{t.testedBy ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}

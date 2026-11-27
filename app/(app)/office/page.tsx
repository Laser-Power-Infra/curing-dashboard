// Office overview (guide 6.1): the detailed numbers. The operator home is app/(app)/page.tsx.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { DrumStatus } from "@/generated/prisma/enums";
import { viewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { drumScope } from "@/lib/scope";
import { compliance, passRate, shiftOf } from "@/services/rules";
import { fmtDateTime, fmtDuration, fmtKm, fmtM, fmtPct, hoursBetween, istDay } from "@/lib/format";
import { Banner, Card, Chip, EmptyState, KpiTile, PageHeader, STATUS, Table, type Tone } from "@/components/ui";
import { one, qs, sentSince, type SP } from "@/components/drums/shared";

const DAY_MS = 86_400_000;
const BAR: Record<Tone, string> = { red: "bg-red-600", amber: "bg-amber-500", blue: "bg-blue-600", green: "bg-green-600", grey: "bg-slate-400" };
const PIPELINE: [DrumStatus, string][] = [
  ["MADE", "Made"],
  ["IN_CURING", "In curing"],
  ["AWAITING_TEST", "Awaiting test"],
  ["TEST_OVERDUE", "Test overdue"],
  ["FAILED", "Failed"],
  ["PASSED", "Passed"],
  // Not in the guide's bar, but without it drums on a requisition would drop out of the picture.
  ["REQUISITION_RAISED", "Requisition raised"],
  ["SENT", "Sent"],
];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  await viewer();
  const line = one((await searchParams).line);
  const now = new Date();
  const today = istDay(now);
  const yesterday = new Date(today.getTime() - DAY_MS);
  const scope = drumScope(line);
  const sentAgg = (kind: string) =>
    prisma.drum.aggregate({
      where: { ...scope, status: "SENT", curingLogs: { some: { sentDate: { gte: sentSince(kind, now)! } } } },
      _count: { _all: true },
      _sum: { lengthM: true },
    });

  const [settings, allLines, shifts, byStatus, sentToday, sentWeek, missing, responsible, recent, tests, escalations, lastSync, noTime, dataErrors] =
    await Promise.all([
      getSettings(),
      prisma.line.findMany({ where: { inScope: true }, orderBy: { name: "asc" } }),
      prisma.shiftDef.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      prisma.drum.groupBy({ by: ["status"], where: scope, _count: { _all: true }, _sum: { lengthM: true } }),
      sentAgg("today"),
      sentAgg("week"),
      prisma.drum.findMany({
        where: { ...scope, status: "MISSING" },
        orderBy: { unloadedAt: "asc" },
        take: 200,
        include: { line: true, tracker: { select: { escalationLevel: true } } },
      }),
      prisma.responsibility.findMany({ where: { area: "CURING_LOG", active: true, person: { active: true } }, orderBy: { isPrimary: "desc" }, include: { person: true } }),
      prisma.drum.findMany({
        where: { ...scope, unloadDate: { gte: yesterday, lte: today } },
        select: { lineId: true, unloadDate: true, unloadedAt: true, status: true, curingLogs: { where: { cycleNo: 1 }, select: { curingStartAt: true }, take: 1 } },
      }),
      prisma.hotSetTest.findMany({
        where: { testedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) }, curingLog: { cycleNo: 1, drum: scope } },
        select: { result: true },
      }),
      prisma.escalation.findMany({
        where: { resolvedAt: null, firedAt: { not: null } },
        select: { level: true, alert: { select: { person: { select: { name: true } } } } },
      }),
      prisma.jobRun.findFirst({ where: { job: { in: ["SHEET_SYNC", "W1_DRUM_SYNC"] }, status: "SUCCESS" }, orderBy: { startedAt: "desc" } }),
      prisma.drum.count({ where: { ...scope, unloadedAt: null } }),
      prisma.drum.count({ where: { ...scope, status: "DATA_ERROR" } }),
    ]);

  const stat = (s: DrumStatus) => {
    const g = byStatus.find((b) => b.status === s);
    return { drums: g?._count._all ?? 0, m: Number(g?._sum.lengthM ?? 0) };
  };
  const drumsHref = (p: Record<string, string | undefined>) => `/drums${qs({ ...p, line })}`;
  const tile = (s: DrumStatus, label: string) => {
    const v = stat(s);
    return <KpiTile label={label} value={v.drums} sub={fmtKm(v.m)} tone={STATUS[s].tone} href={drumsHref({ status: s })} />;
  };
  const pipeline = PIPELINE.map(([s, label]) => ({ s, label, ...stat(s) }));

  const lines = allLines.filter((l) => !line || l.code === line);
  const responsibleNames = responsible.map((r) => r.person.name).join(", ") || "Nobody set";

  const comp = (lineId: string, day: Date, shift?: string) =>
    compliance(
      recent
        .filter((d) => d.lineId === lineId && d.unloadDate.getTime() === day.getTime() && (!shift || (d.unloadedAt != null && shiftOf(d.unloadedAt, shifts) === shift)))
        .map((d) => ({ unloadedAt: d.unloadedAt, curingStartAt: d.curingLogs[0]?.curingStartAt ?? null, dataError: d.status === "DATA_ERROR" })),
      now,
      settings.curingStartLimitHours,
    );
  const compCell = (lineCode: string, lineId: string, day: Date, shift?: string) => {
    const c = comp(lineId, day, shift);
    return (
      <td className="tabular-nums">
        <Link href={`/drums${qs({ line: lineCode, date: isoDay(day) })}`} className="inline-flex min-h-11 flex-col justify-center text-blue-700 underline">
          {c.pct == null ? "Nothing due" : `${fmtPct(c.pct)} (${c.onTime} of ${c.due})`}
        </Link>
        {!shift && c.unknownTime > 0 && <div className="text-xs text-slate-600">{c.unknownTime} time unknown</div>}
      </td>
    );
  };

  const results = tests.map((t) => t.result);
  const passed = results.filter((r) => r === "PASS").length;

  const openEsc = new Map<string, { person: string; level: number; count: number }>();
  for (const e of escalations) {
    const person = e.alert?.person?.name ?? "Not assigned";
    const row = openEsc.get(`${person}|${e.level}`) ?? { person, level: e.level, count: 0 };
    row.count++;
    openEsc.set(`${person}|${e.level}`, row);
  }
  const escRows = [...openEsc.values()].sort((a, b) => b.level - a.level || a.person.localeCompare(b.person));

  const stale = !lastSync || hoursBetween(lastSync.startedAt, now) > settings.staleFeedHours;
  const complianceHelp = `Drums whose curing started within ${settings.curingStartLimitHours} h of unload ÷ drums due (unloaded more than ${settings.curingStartLimitHours} h ago, curing items only, Data errors left out) × 100. By unload time. Drums with no unload time are left out and counted separately.`;
  const passHelp = "Passed ÷ (passed + failed) × 100, counting hot set tests of the first curing cycle only, tested in the last 30 days.";

  return (
    <div className="space-y-4">
      <PageHeader title="Office overview" sub={`As of ${fmtDateTime(now)} IST`} />

      {(stale || noTime > 0 || dataErrors > 0) && (
        <Banner tone={stale || dataErrors > 0 ? "red" : "amber"}>
          <ul className="space-y-1">
            {stale && (
              <li>
                Drum feed is not up to date: {lastSync ? `the last sync was ${fmtDateTime(lastSync.startedAt)}, ${Math.floor(hoursBetween(lastSync.startedAt, now))} hours ago. It should run at least every ${settings.staleFeedHours} hours` : "no sync has run yet"}.
              </li>
            )}
            {dataErrors > 0 && (
              <li>
                <Link href={`/tracker${qs({ tab: "data-error", line })}`} className="font-medium underline">
                  {dataErrors} drum{dataErrors === 1 ? "" : "s"} with a Data error
                </Link>{" "}
                need a person to link them.
              </li>
            )}
            {noTime > 0 && (
              <li>
                <Link href={drumsHref({ time: "unknown" })} className="font-medium underline">
                  {noTime} drum{noTime === 1 ? "" : "s"} with no unload time
                </Link>
                : the {settings.curingStartLimitHours}-hour check cannot run on them.
              </li>
            )}
          </ul>
        </Banner>
      )}

      <nav aria-label="Line" className="flex gap-1 overflow-x-auto">
        {[{ code: undefined as string | undefined, name: "All lines" }, ...allLines].map((l) => (
          <Link
            key={l.code ?? "all"}
            href={`/office${qs({ line: l.code })}`}
            aria-current={l.code === line ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-700 ${
              l.code === line ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {l.name}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tile("MISSING", "Missing now")}
        {tile("IN_CURING", "In curing")}
        {tile("AWAITING_TEST", "Awaiting test")}
        {tile("TEST_OVERDUE", "Test overdue")}
        {tile("FAILED", "Failed")}
        {tile("PASSED", "Passed – ready to send")}
        <KpiTile label="Sent today" value={sentToday._count._all} sub={fmtKm(sentToday._sum.lengthM ?? 0)} href={drumsHref({ status: "SENT", sent: "today" })} />
        <KpiTile label="Sent this week" value={sentWeek._count._all} sub={fmtKm(sentWeek._sum.lengthM ?? 0)} href={drumsHref({ status: "SENT", sent: "week" })} />
      </div>

      <Card title="Pipeline">
        <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          {pipeline.map((p) => (
            <div key={p.s} className={BAR[STATUS[p.s].tone]} style={{ flexGrow: p.drums }} />
          ))}
        </div>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {pipeline.map((p) => (
            <li key={p.s}>
              <Link href={drumsHref({ status: p.s })} className="block min-h-11 rounded-md border border-slate-200 p-2 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-blue-700">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <span className={`size-2 shrink-0 rounded-full ${BAR[STATUS[p.s].tone]}`} aria-hidden />
                  {p.label}
                </div>
                <div className="text-base font-semibold tabular-nums text-slate-900">{p.drums} drums</div>
                <div className="text-xs tabular-nums text-slate-600">{fmtKm(p.m)}</div>
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Missing drums now">
        {missing.length === 0 ? (
          <EmptyState>No missing drums right now</EmptyState>
        ) : (
          <div className="space-y-4">
            {lines
              .map((l) => ({ l, drums: missing.filter((d) => d.lineId === l.id) }))
              .filter((g) => g.drums.length > 0)
              .map(({ l, drums }) => (
                <div key={l.id}>
                  <h3 className="mb-1 text-sm font-medium text-slate-900">
                    {l.name} · {drums.length} missing · {fmtKm(drums.reduce((s, d) => s + Number(d.lengthM), 0))}
                  </h3>
                  <ul className="space-y-2">
                    {drums.map((d) => (
                      <li key={d.id}>
                        <Link href={`/drums/${d.id}`} className="block rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 hover:border-red-400 focus-visible:outline-2 focus-visible:outline-blue-700">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">Drum {d.drumNo} · {fmtM(d.lengthM)}</span>
                            <Chip tone="red">Level {d.tracker?.escalationLevel ?? 0}</Chip>
                          </div>
                          <div>
                            Unloaded {fmtDateTime(d.unloadedAt)} · <span className="font-semibold">{d.unloadedAt ? fmtDuration(hoursBetween(d.unloadedAt, now)) : "–"}</span> since unload
                          </div>
                          <div>Responsible: {responsibleNames}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </Card>

      <Card title={<span title={complianceHelp}>{settings.curingStartLimitHours}-hour compliance <span aria-hidden>ⓘ</span></span>}>
        {lines.length === 0 ? (
          <EmptyState>No lines are set up for curing checks</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Line / shift</th>
                <th>Today</th>
                <th>Yesterday</th>
              </tr>
            </thead>
            <tbody>
              {lines.flatMap((l) => [
                <tr key={l.id} className="font-medium">
                  <td>{l.name}</td>
                  {compCell(l.code, l.id, today)}
                  {compCell(l.code, l.id, yesterday)}
                </tr>,
                ...shifts.map((s) => (
                  <tr key={`${l.id}-${s.id}`}>
                    <td className="pl-6 text-slate-600">{s.name}</td>
                    {compCell(l.code, l.id, today, s.code)}
                    {compCell(l.code, l.id, yesterday, s.code)}
                  </tr>
                )),
              ])}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={<span title={passHelp}>Pass rate, last 30 days <span aria-hidden>ⓘ</span></span>}>
          <Link href="/tests" className="block min-h-11 focus-visible:outline-2 focus-visible:outline-blue-700">
            <div className="text-[28px] leading-8 font-semibold tabular-nums text-slate-900">{fmtPct(passRate(results))}</div>
            <div className="text-xs text-slate-600">
              {results.length === 0 ? "No first-cycle tests in the last 30 days" : `${passed} passed of ${results.length} first-cycle tests`}
            </div>
          </Link>
        </Card>

        <Card title="Open escalations">
          {escRows.length === 0 ? (
            <EmptyState>No open escalations</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Level</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {escRows.map((e) => (
                  <tr key={`${e.person}|${e.level}`}>
                    <td>{e.person}</td>
                    <td className="tabular-nums">{e.level}</td>
                    <td className="tabular-nums">
                      <Link href="/alerts" className="inline-flex min-h-11 items-center font-medium text-blue-700 underline">{e.count}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

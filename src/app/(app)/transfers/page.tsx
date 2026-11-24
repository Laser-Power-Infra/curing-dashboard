// Ready to Send / Transfers (guide 6.6, rules 5.6 and 5.7).
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fmtDateTime, fmtDuration, fmtKm, fmtM, hoursBetween } from "@/lib/format";
import { Card, Chip, EmptyState, LinkButton, PageHeader, StatusChip, Table, type Tone } from "@/components/ui";
import { ActionForm } from "../settings/action-form";
import { cancelRequisition, markDispatched, raiseRequisition } from "./actions";

const HOLD_REASON = "Failed hot set – must be re-cured and pass before it can be sent";

export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, settings, sp] = await Promise.all([requireUser(), getSettings(), searchParams]);
  const mayTransfer = can(user, "transfer");
  const now = new Date();
  const drum = { include: { line: true } } as const;

  const [passed, failed, open, dispatched] = await Promise.all([
    // shortcut: the whole ready list is loaded and sorted here because "passed at" lives on the test row; page it if it ever grows past a few hundred drums.
    prisma.curingLog.findMany({
      where: { testResult: "PASS", sentDate: null, requisitionId: null },
      include: { drum, hotSetTests: { where: { result: "PASS" }, orderBy: { testedAt: "desc" }, take: 1 } },
    }),
    prisma.curingLog.findMany({
      where: { testResult: "FAIL", sentDate: null },
      include: { drum: { include: { line: true, curingLogs: { select: { cycleNo: true } } } } },
      orderBy: { curingStartAt: "asc" },
    }),
    prisma.requisition.findMany({ where: { status: "RAISED" }, include: { curingLogs: { include: { drum } } }, orderBy: { raisedAt: "asc" } }),
    prisma.requisition.findMany({ where: { status: "DISPATCHED" }, include: { _count: { select: { curingLogs: true } } }, orderBy: { dispatchedAt: "desc" }, take: 20 }),
  ]);

  const buckets = settings.ageingBucketsHours;
  const bucketLabel = (i: number) => (i === buckets.length ? `> ${buckets[i - 1]} h` : `${i ? buckets[i - 1] : 0}–${buckets[i]} h`);
  const bucketTone = (i: number): Tone => (i === 0 ? "green" : i === buckets.length ? "red" : "amber");
  const len = (r: { lengthM: unknown; drum: { lengthM: unknown } | null }) => Number(r.lengthM ?? r.drum?.lengthM ?? 0);

  const ready = passed
    .map((r) => {
      const passedAt = r.hotSetTests[0]?.testedAt ?? r.curingEndAt ?? r.createdAt;
      const age = hoursBetween(passedAt, now);
      const bucket = buckets.findIndex((b) => age < b);
      return { ...r, passedAt, age, bucket: bucket === -1 ? buckets.length : bucket };
    })
    .sort((a, b) => a.passedAt.getTime() - b.passedAt.getTime());
  const ageFilter = typeof sp.age === "string" && sp.age !== "" ? Number(sp.age) : null;
  const shown = ageFilter == null ? ready : ready.filter((r) => r.bucket === ageFilter);
  // A failed cycle that already has a re-cure after it is no longer the drum's latest result.
  const onHold = failed.filter((r) => !r.drum?.curingLogs.some((c) => c.cycleNo > r.cycleNo));

  const readyRows = shown.map((r) => (
    <tr key={r.id}>
      {mayTransfer && (
        <td>
          <label className="flex min-h-11 min-w-11 items-center justify-center">
            <input type="checkbox" name="ids" value={r.id} className="size-5" />
            <span className="sr-only">Select drum {r.coreDrumNo}</span>
          </label>
        </td>
      )}
      <td>{r.lotNo ?? "–"}</td>
      <td className="font-medium">{r.drumId ? <Link href={`/drums/${r.drumId}`} className="underline">{r.coreDrumNo}</Link> : r.coreDrumNo}</td>
      <td>{r.drum?.line.name ?? "–"}</td>
      <td className="text-right tabular-nums">{fmtM(len(r))}</td>
      <td className="whitespace-nowrap">{fmtDateTime(r.passedAt)}</td>
      <td className="whitespace-nowrap"><Chip tone={bucketTone(r.bucket)}>{bucketLabel(r.bucket)}</Chip> <span className="text-xs text-slate-600">{fmtDuration(r.age)}</span></td>
    </tr>
  ));
  const readyTable = (
    <Table>
      <thead>
        <tr>{mayTransfer && <th>Send</th>}<th>Lot no</th><th>Drum no</th><th>Line</th><th className="text-right">Length</th><th>Passed at</th><th>Waiting since pass</th></tr>
      </thead>
      <tbody>{readyRows}</tbody>
    </Table>
  );

  return (
    <>
      <PageHeader title="Ready to send" sub="Drums that passed the hot set test and are waiting to go from Kharagpur to Polypark. Oldest first." />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/transfers" className="flex min-h-11 items-center gap-2 font-semibold text-slate-900 underline">
            {ready.length} drum{ready.length === 1 ? "" : "s"} · {fmtKm(ready.reduce((s, r) => s + len(r), 0))}
          </Link>
          {[...buckets, null].map((_, i) => (
            <Link key={i} href={`/transfers?age=${i}`} aria-current={ageFilter === i ? "true" : undefined} className={`flex min-h-11 items-center gap-1 rounded-md px-2 ${ageFilter === i ? "bg-slate-100" : ""}`}>
              <Chip tone={bucketTone(i)}>{bucketLabel(i)}</Chip>
              <span className="tabular-nums underline">{ready.filter((r) => r.bucket === i).length}</span>
            </Link>
          ))}
        </div>
      </Card>

      {!shown.length ? (
        <EmptyState>{ready.length ? "No drums in this age group." : "No passed drums are waiting to be sent right now."}</EmptyState>
      ) : mayTransfer ? (
        <ActionForm reset action={raiseRequisition} submit="Raise requisition" confirm="Raise a transfer requisition for the ticked drums?">
          {readyTable}
        </ActionForm>
      ) : (
        readyTable
      )}

      <h2 className="mt-8 mb-2 text-base font-semibold text-slate-900">On hold – cannot be sent</h2>
      {!onHold.length ? (
        <EmptyState>No failed drums on hold.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr><th>Lot no</th><th>Drum no</th><th>Line</th><th className="text-right">Length</th><th>Status</th><th>Why it cannot be sent</th></tr>
          </thead>
          <tbody>
            {onHold.map((r) => (
              <tr key={r.id} title={HOLD_REASON}>
                <td>{r.lotNo ?? "–"}</td>
                <td className="font-medium">{r.drumId ? <Link href={`/drums/${r.drumId}`} className="underline">{r.coreDrumNo}</Link> : r.coreDrumNo}</td>
                <td>{r.drum?.line.name ?? "–"}</td>
                <td className="text-right tabular-nums">{fmtM(len(r))}</td>
                <td><StatusChip status="FAILED" /></td>
                <td className="min-w-56 text-slate-700">{HOLD_REASON}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <h2 className="mt-8 mb-2 text-base font-semibold text-slate-900">Open requisitions</h2>
      {!open.length ? (
        <EmptyState>No open requisitions.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {open.map((q) => (
            <Card key={q.id} title={<>{q.reqNo} <StatusChip status={q.status} /></>}>
              <p className="mb-2 text-sm text-slate-600">
                Raised {fmtDateTime(q.raisedAt)} by {q.raisedBy ?? "–"} · {q.curingLogs.length} drum{q.curingLogs.length === 1 ? "" : "s"} · {fmtKm(q.totalLengthM)}
              </p>
              <ul className="mb-3 text-sm text-slate-800">
                {q.curingLogs.map((l) => (
                  <li key={l.id}>Lot {l.lotNo ?? "–"} · Drum {l.coreDrumNo} · {fmtM(len(l))}</li>
                ))}
              </ul>
              <div className="flex flex-wrap items-start gap-3">
                <LinkButton href={`/transfers/${q.id}`} variant="secondary">Print / share</LinkButton>
                {mayTransfer && (
                  <>
                    <ActionForm action={markDispatched} submit="Mark dispatched" className="[&>div]:mt-0" confirm={`Mark ${q.reqNo} as dispatched? All ${q.curingLogs.length} drums on it will be marked Sent. This cannot be undone.`}>
                      <input type="hidden" name="id" value={q.id} />
                    </ActionForm>
                    <ActionForm action={cancelRequisition} submit="Cancel requisition" variant="secondary" className="[&>div]:mt-0" confirm={`Cancel ${q.reqNo}? Its drums go back to the ready list.`}>
                      <input type="hidden" name="id" value={q.id} />
                    </ActionForm>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-8 mb-2 text-base font-semibold text-slate-900">Recently dispatched</h2>
      {!dispatched.length ? (
        <EmptyState>Nothing dispatched yet.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr><th>Requisition</th><th>Dispatched at</th><th className="text-right">Drums</th><th className="text-right">Total</th><th>Raised by</th></tr>
          </thead>
          <tbody>
            {dispatched.map((q) => (
              <tr key={q.id}>
                <td><Link href={`/transfers/${q.id}`} className="inline-flex min-h-11 items-center text-blue-700 underline">{q.reqNo}</Link></td>
                <td className="whitespace-nowrap">{fmtDateTime(q.dispatchedAt)}</td>
                <td className="text-right tabular-nums">{q._count.curingLogs}</td>
                <td className="text-right tabular-nums">{fmtKm(q.totalLengthM)}</td>
                <td>{q.raisedBy ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

// Drum detail (guide 6.3): timeline, curing cycles, tests, alerts, tracker row, audit history, actions.
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { can, isStaff, viewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fmtDateOnly, fmtDateTime, fmtDuration, fmtM, hoursBetween, sizeTag } from "@/lib/format";
import { Card, Chip, EmptyState, Field, PageHeader, Select, StatusChip, Table } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { TrackerEdit } from "@/components/tracker/edit";
import { REASONS, mayEditTracker, trackId, type TrackerField } from "@/lib/tracker";
import { linkCuringRow, setCuringItem } from "@/actions/drums";
import { ConfirmForm } from "@/components/drums/confirm-form";
import { nextAction } from "@/lib/next-action";
import { StepBar } from "@/components/home/step-bar";

const show = (v: unknown) => (v == null ? "–" : typeof v === "string" ? v : JSON.stringify(v));

export default async function DrumPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await viewer();
  const { id } = await params;
  const [drum, settings] = await Promise.all([
    prisma.drum.findUnique({
      where: { id },
      include: {
        line: true,
        product: { select: { code: true } },
        tracker: { include: { curingLog: { select: { lotNo: true, cycleNo: true } } } },
        curingLogs: { orderBy: { cycleNo: "asc" }, include: { curingUnit: true, requisition: true, hotSetTests: { orderBy: { testedAt: "asc" } } } },
      },
    }),
    getSettings(),
  ]);
  if (!drum) notFound();

  const logs = drum.curingLogs;
  const tests = logs.flatMap((l) => l.hotSetTests.map((t) => ({ ...t, cycleNo: l.cycleNo })));
  const tracker = drum.tracker;
  const ids = [drum.id, ...logs.map((l) => l.id), ...tests.map((t) => t.id), ...(tracker ? [tracker.id] : [])];
  const canLink = drum.isCuringItem && can(user, drum.status === "DATA_ERROR" ? "resolveDataError" : "curingEntry");

  const [escalations, history, candidates] = await Promise.all([
    prisma.escalation.findMany({ where: { objectId: { in: ids }, alertId: { not: null } }, include: { alert: { include: { person: true } } } }),
    // Row ids are cuids, unique across tables, so the id list alone picks this drum's history.
    prisma.auditLog.findMany({ where: { rowId: { in: ids } }, orderBy: { changedAt: "desc" }, take: 100 }),
    canLink
      ? prisma.curingLog.findMany({
          where: { drumId: null, coreDrumNo: { equals: drum.drumNo, mode: "insensitive" } },
          orderBy: { curingStartAt: "asc" },
          include: { curingUnit: true },
        })
      : [],
  ]);
  const alerts = [...new Map(escalations.flatMap((e) => (e.alert ? [[e.alert.id, e.alert] as const] : []))).values()].sort(
    (a, b) => b.queuedAt.getTime() - a.queuedAt.getTime(),
  );

  // Timeline of the latest cycle. The 6-hour check is on the first curing start.
  const latest = logs.at(-1);
  const lastTest = latest?.hotSetTests.at(-1);
  const startDelay = drum.unloadedAt && logs[0] ? hoursBetween(drum.unloadedAt, logs[0].curingStartAt) : null;
  const testDelay = lastTest && latest?.testDueAt ? hoursBetween(latest.testDueAt, lastTest.testedAt) : null;
  const steps: { name: string; at?: Date | null; who?: string | null; note?: string | null; breach?: string | false | null }[] = [
    { name: "Unloaded", at: drum.unloadedAt, who: drum.enteredBy, note: drum.unloadedAt ? null : `${fmtDateOnly(drum.unloadDate)}, time unknown` },
    {
      name: "Curing start",
      at: latest?.curingStartAt,
      who: latest?.createdBy,
      breach: startDelay != null && startDelay > settings.curingStartLimitHours && `Late: first curing started ${fmtDuration(startDelay)} after unload. The limit is ${settings.curingStartLimitHours} h.`,
    },
    {
      name: "Curing end",
      at: latest?.curingEndAt,
      breach: latest?.timeCheck === "UNDER_CURED" && `Under-cured: ${fmtDuration(latest.actualCuringHrs)} against ${fmtDuration(latest.plannedCuringHrs)} approved.`,
    },
    { name: "Test due", at: latest?.testDueAt, breach: drum.status === "TEST_OVERDUE" && "Test overdue: no result entered yet." },
    {
      name: "Result",
      at: lastTest?.testedAt,
      who: lastTest?.testedBy,
      note: lastTest && (lastTest.result === "PASS" ? "Pass" : null),
      breach:
        [
          lastTest?.result === "FAIL" && "Fail: hold / re-cure.",
          testDelay != null && testDelay > settings.testOverdueGraceHours && `Tested ${fmtDuration(testDelay)} after the test was due. Allowed: ${settings.testOverdueGraceHours} h.`,
        ]
          .filter(Boolean)
          .join(" ") || null,
    },
    { name: "Requisition", at: latest?.requisition?.raisedAt, who: latest?.requisition?.raisedBy, note: latest?.requisition?.reqNo },
    { name: "Sent", at: latest?.sentDate },
  ];
  // Same journey bar as the home cards.
  const journey = nextAction(
    drum,
    latest
      ? {
          curingStartAt: latest.curingStartAt,
          curingEndAt: latest.curingEndAt,
          plannedCuringHrs: latest.plannedCuringHrs == null ? null : Number(latest.plannedCuringHrs),
          testDueAt: latest.testDueAt,
          testedAt: lastTest?.testedAt ?? null,
          requisitionRaisedAt: latest.requisition?.raisedAt ?? null,
        }
      : null,
    new Date(),
    settings,
  );
  let prev = null as Date | null;
  const timeline = steps.map((s) => {
    const took = s.at && prev ? hoursBetween(prev, s.at) : null;
    if (s.at) prev = s.at;
    return { ...s, took };
  });

  const manual = (field: TrackerField, label: string) => {
    if (!tracker) return null;
    const value = tracker[field] ?? "";
    return (
      <div>
        <dt className="text-xs text-slate-600">{label}</dt>
        <dd>
          {mayEditTracker(user, field, tracker.closedAt != null) ? (
            <TrackerEdit id={tracker.id} field={field} value={value} label={label} />
          ) : field === "reason" && tracker.reason ? (
            REASONS[tracker.reason]
          ) : (
            value || "–"
          )}
        </dd>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader title={`Drum ${drum.drumNo}`} sub={`Grid ID ${drum.gridEntryId} · ${drum.line.name}`}>
        <StatusChip status={drum.status} />
        {!drum.unloadedAt && <Chip>time unknown</Chip>}
        {drum.dataFlags.map((f) => (
          <Chip key={f}>{f.replaceAll("_", " ").toLowerCase()}</Chip>
        ))}
      </PageHeader>

      <Card>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-600">Party</dt><dd>{drum.party ?? "Party not given"}</dd></div>
          <div><dt className="text-xs text-slate-600">Item</dt><dd>{drum.coreItem}</dd></div>
          <div><dt className="text-xs text-slate-600">Item code</dt><dd>{drum.product?.code ?? "–"}</dd></div>
          <div><dt className="text-xs text-slate-600">Size</dt><dd>{sizeTag(drum.coreItem) ? <Chip tone="blue">{sizeTag(drum.coreItem)}</Chip> : "–"}</dd></div>
          <div><dt className="text-xs text-slate-600">Length</dt><dd className="tabular-nums">{fmtM(drum.lengthM)}</dd></div>
          <div><dt className="text-xs text-slate-600">Prod orders</dt><dd>{drum.prodOrders.join(", ") || "–"}</dd></div>
          <div><dt className="text-xs text-slate-600">Drum size</dt><dd>{drum.drumSize ?? "–"}</dd></div>
        </dl>
      </Card>

      <Card title={`Timeline${latest && latest.cycleNo > 1 ? ` – curing cycle ${latest.cycleNo}` : ""}`}>
        <div className="mb-4">
          <StepBar current={journey.step} late={journey.tone === "red" ? journey.step : null} />
        </div>
        <ol className="space-y-3">
          {timeline.map((s) => (
            <li key={s.name} className={`border-l-4 pl-3 text-sm ${s.breach ? "border-red-600" : s.at ? "border-green-600" : "border-slate-200"}`}>
              <div className="font-medium text-slate-900">{s.name}</div>
              <div className="text-slate-600">
                {s.at ? fmtDateTime(s.at) : (s.note ?? "Not yet")}
                {s.at && s.note ? ` · ${s.note}` : ""}
                {s.who ? ` · ${s.who}` : ""}
                {s.took != null ? ` · ${fmtDuration(s.took)} after the previous step` : ""}
              </div>
              {s.breach && <div className="font-medium text-red-700">Limit broken – {s.breach}</div>}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Curing cycles">
        {logs.length === 0 ? (
          <EmptyState>No curing row is linked to this drum yet</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Cycle</th><th>Lot no</th><th>Tank</th><th>Start</th><th>End</th><th>Approved</th><th>Actual</th><th>Deviation</th>
                <th>Time check</th><th>Visual</th><th>Test due</th><th>Result</th><th>Status</th><th>Linked</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="whitespace-nowrap">
                  <td>{l.cycleNo}</td>
                  <td>{l.lotNo ?? "–"}</td>
                  <td>{l.curingUnit?.name ?? l.chamberTankText ?? "–"}</td>
                  <td>{fmtDateTime(l.curingStartAt)}</td>
                  <td>{fmtDateTime(l.curingEndAt)}</td>
                  <td>{fmtDuration(l.plannedCuringHrs)}</td>
                  <td>{fmtDuration(l.actualCuringHrs)}</td>
                  <td>{fmtDuration(l.hoursDeviation)}</td>
                  <td><StatusChip status={l.timeCheck} /></td>
                  <td><StatusChip status={l.visualCheck} /></td>
                  <td>{fmtDateTime(l.testDueAt)}</td>
                  <td><StatusChip status={l.testResult} /></td>
                  <td><StatusChip status={l.lotStatus} /></td>
                  <td>{l.matchMethod === "MANUAL" ? "By a person" : l.matchMethod === "AUTO" ? "Automatic" : "–"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Hot set tests">
        {tests.length === 0 ? (
          <EmptyState>No hot set test entered yet</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><th>Cycle</th><th>Tested at</th><th>Tested by</th><th>Sample end</th><th>Test type</th><th>Hot set %</th><th>Permanent set %</th><th>Result</th><th>Remarks</th></tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id}>
                  <td>{t.cycleNo}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(t.testedAt)}</td>
                  <td>{t.testedBy ?? "–"}</td>
                  <td>{t.sampleEnd ?? "–"}</td>
                  <td>{t.testType ?? "–"}</td>
                  <td className="tabular-nums">{t.hotSetPct?.toString() ?? "–"}</td>
                  <td className="tabular-nums">{t.permanentSetPct?.toString() ?? "–"}</td>
                  <td><StatusChip status={t.result} /></td>
                  <td>{t.remarks ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Missing Drum Tracker">
        {!tracker ? (
          <EmptyState>This drum has never been on the Missing Drum Tracker</EmptyState>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-600">Track ID</dt><dd>{trackId(tracker.trackNo)}</dd></div>
            <div><dt className="text-xs text-slate-600">Status</dt><dd><StatusChip status={tracker.status} /></dd></div>
            <div>
              <dt className="text-xs text-slate-600">Hours since unload</dt>
              <dd>{!drum.unloadedAt ? <Chip>time unknown</Chip> : tracker.closedAt ? "–" : fmtDuration(hoursBetween(drum.unloadedAt, new Date()))}</dd>
            </div>
            <div><dt className="text-xs text-slate-600">Curing row</dt><dd>{tracker.curingLog ? (tracker.curingLog.lotNo ?? `Cycle ${tracker.curingLog.cycleNo}`) : "–"}</dd></div>
            <div><dt className="text-xs text-slate-600">Curing start</dt><dd>{fmtDateTime(tracker.curingStartAt)}</dd></div>
            <div><dt className="text-xs text-slate-600">Hours late</dt><dd>{fmtDuration(tracker.hoursLate)}</dd></div>
            <div><dt className="text-xs text-slate-600">Escalation level</dt><dd>{tracker.escalationLevel}</dd></div>
            <div><dt className="text-xs text-slate-600">Last alert</dt><dd>{fmtDateTime(tracker.lastAlertAt)}</dd></div>
            <div><dt className="text-xs text-slate-600">Closed on</dt><dd>{fmtDateTime(tracker.closedAt)}</dd></div>
            {manual("reason", "Reason")}
            {manual("remarks", "Remarks")}
            {manual("mdRemarks", "MD Remarks")}
          </dl>
        )}
      </Card>

      {(canLink || can(user, "masters")) && (
        <Card title="Actions">
          <div className="grid gap-6 md:grid-cols-2">
            {canLink && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-slate-900">Link to a curing row</h3>
                {candidates.length === 0 ? (
                  <p className="text-sm text-slate-600">No unlinked curing row has drum no {drum.drumNo}.</p>
                ) : (
                  <ConfirmForm action={linkCuringRow.bind(null, drum.id)} confirmText={`Link this curing row to drum ${drum.drumNo} (Grid ID ${drum.gridEntryId})? This cannot be undone from this screen.`}>
                    <Field id="logId" label="Unlinked curing rows with this drum no">
                      <Select id="logId" name="logId" required defaultValue="">
                        <option value="" disabled>Choose a curing row</option>
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {[c.lotNo ?? "No lot no", `started ${fmtDateTime(c.curingStartAt)}`, c.curingUnit?.name ?? c.chamberTankText].filter(Boolean).join(" · ")}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <SubmitButton>Link curing row</SubmitButton>
                  </ConfirmForm>
                )}
              </div>
            )}
            {can(user, "masters") && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-slate-900">{drum.isCuringItem ? "Not a curing item?" : "Marked as not a curing item"}</h3>
                <ConfirmForm
                  action={setCuringItem.bind(null, drum.id, !drum.isCuringItem)}
                  confirmText={
                    drum.isCuringItem
                      ? `Mark drum ${drum.drumNo} as not a curing item? It will leave every curing list, count and alert.`
                      : `Put drum ${drum.drumNo} back in the curing lists? The curing checks will apply to it again.`
                  }
                >
                  <p className="text-sm text-slate-600">Compact and bare conductors are not cured. The drum stays on record either way.</p>
                  <SubmitButton variant="secondary">{drum.isCuringItem ? "Mark as not a curing item" : "Undo – it is a curing item"}</SubmitButton>
                </ConfirmForm>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card title="Alerts sent">
        {alerts.length === 0 ? (
          <EmptyState>No alerts have been sent about this drum</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><th>When</th><th>Level</th><th>To</th><th>Status</th><th>Message</th></tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(a.sentAt ?? a.queuedAt)}</td>
                  <td>{a.level ?? "–"}</td>
                  <td className="whitespace-nowrap">{a.person?.name ?? ((isStaff(user) && a.phone) || "–")}</td>
                  <td><StatusChip status={a.status} />{a.isTest && <> <Chip>test</Chip></>}</td>
                  <td className="min-w-64">{a.message}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Change history">
        {history.length === 0 ? (
          <EmptyState>No changes recorded for this drum</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><th>When</th><th>Who</th><th>Record</th><th>Field</th><th>From</th><th>To</th></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(h.changedAt)}</td>
                  <td>{h.changedBy ?? "–"}</td>
                  <td className="whitespace-nowrap">{h.tableName.replaceAll("_", " ")}</td>
                  <td>{h.field ?? h.action.toLowerCase()}</td>
                  <td>{show(h.oldValue)}</td>
                  <td>{show(h.newValue)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

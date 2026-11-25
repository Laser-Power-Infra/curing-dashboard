// Bodies of the background jobs (guide 10). The route in [job]/route.ts handles auth and the JobRun record.
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { fmtDateOnly, fmtDateTime, fmtDuration, fmtKm, fmtPct, hoursBetween, istDay, istDayStart, parseDateOnly, parseIstInput } from "@/lib/format";
import { compliance, looksLikeCuringItem, passRate } from "@/services/rules";
import { runAll } from "@/services/rules/run";
import { escalate, type Condition } from "@/services/alerts/escalate";
import { sendMessage } from "@/services/alerts/send";
import { appUrl, renderAlert } from "@/services/alerts/templates";
import type { Prisma } from "@/generated/prisma/client";

export type JobResult = { rowsRead: number; rowsChanged: number; alerts: number; details?: Prisma.InputJsonObject };

const HOUR = 3_600_000;
const str = (v: unknown) => (v == null ? "" : String(v).trim());

// ---------------------------------------------------------------------------
// W1 – drum sync. Adds new Grid IDs only; never overwrites what a person filled in.
// ---------------------------------------------------------------------------
export async function drumSync(body: unknown): Promise<JobResult> {
  const rows = (body as { rows?: unknown } | null)?.rows ?? [];
  if (!Array.isArray(rows)) throw new Error('Body must be { "rows": [ … ] }');
  if (!rows.length) return { rowsRead: 0, rowsChanged: 0, alerts: 0 };

  const now = new Date();
  const lineKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const [lines, products] = await Promise.all([prisma.line.findMany(), prisma.product.findMany({ select: { id: true, name: true, isCuringItem: true } })]);
  const lineBy = new Map(lines.flatMap((l) => [[lineKey(l.name), l] as const, [lineKey(l.code), l] as const]));
  const productBy = new Map(products.map((p) => [p.name.trim().toUpperCase(), p]));

  const rejected: { row: number; gridEntryId: string; reason: string }[] = [];
  const valid = new Map<string, Prisma.DrumCreateManyInput>();
  let outOfScope = 0;
  rows.forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const gridEntryId = str(r.gridEntryId);
    const reject = (reason: string) => rejected.push({ row: i + 1, gridEntryId, reason });
    const line = lineBy.get(lineKey(str(r.line)));
    const unloadDate = parseDateOnly(str(r.unloadDate));
    const time = str(r.unloadTime);
    const unloadedAt = time ? parseIstInput(`${str(r.unloadDate)}T${time.padStart(5, "0")}`) : null;
    const coreItem = str(r.coreItem);
    const drumNo = str(r.drumNo);
    const lengthM = Number(str(r.lengthM).replace(/,/g, ""));
    if (!gridEntryId) return reject("Grid entry ID is blank");
    if (valid.has(gridEntryId)) return reject("Grid entry ID is repeated in this batch");
    if (!line) return reject(`Line "${str(r.line)}" is not known`);
    if (!line.inScope) return void outOfScope++;
    if (!unloadDate) return reject("Unload date must be YYYY-MM-DD");
    if (time && (!/^\d{1,2}:\d{2}$/.test(time) || !unloadedAt)) return reject("Unload time must be HH:mm");
    if (!coreItem) return reject("Core item is blank");
    if (!drumNo) return reject("Drum no is blank");
    if (str(r.lengthM) === "" || !Number.isFinite(lengthM) || lengthM < 0 || lengthM >= 1e8) return reject("Length (m) must be a number");
    const product = productBy.get(coreItem.toUpperCase());
    const isCuringItem = product ? product.isCuringItem : looksLikeCuringItem(coreItem);
    valid.set(gridEntryId, {
      gridEntryId,
      lineId: line.id,
      unloadDate,
      unloadedAt,
      unloadTimeSource: unloadedAt ? "SFG" : "UNKNOWN",
      prodOrders: str(r.prodOrders).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
      mcNo: str(r.mcNo) || null,
      party: str(r.party) || null,
      coreItem,
      productId: product?.id ?? null,
      drumNo,
      drumSize: str(r.drumSize) || null,
      lengthM,
      enteredBy: str(r.enteredBy) || null,
      stockStatus: str(r.stockStatus) || null,
      isCuringItem,
      status: isCuringItem ? "MADE" : "NOT_CURING_ITEM",
      dataFlags: isCuringItem ? [] : ["NOT_CURING_ITEM"],
      source: "SFG_SYNC",
      lastSyncAt: now,
      createdBy: "job:W1",
    });
  });

  const existing = await prisma.drum.findMany({
    where: { gridEntryId: { in: [...valid.keys()] } },
    select: { id: true, gridEntryId: true, unloadedAt: true, unloadDate: true },
  });
  const known = new Set(existing.map((d) => d.gridEntryId));
  const fresh = [...valid.values()].filter((d) => !known.has(d.gridEntryId));
  const inserted = fresh.length ? (await prisma.drum.createMany({ data: fresh, skipDuplicates: true })).count : 0;

  // The only update allowed on an existing drum: fill a missing unload time.
  let timeFilled = 0;
  for (const d of existing) {
    const feed = valid.get(d.gridEntryId)!;
    if (d.unloadedAt || !feed.unloadedAt || new Date(feed.unloadDate).getTime() !== d.unloadDate.getTime()) continue;
    timeFilled += (
      await prisma.drum.updateMany({
        where: { id: d.id, unloadedAt: null },
        data: { unloadedAt: feed.unloadedAt, unloadTimeSource: "SFG", lastSyncAt: now, updatedBy: "job:W1" },
      })
    ).count;
  }

  const changed = inserted + timeFilled;
  const rules = changed ? await runAll("job:W1") : { alerts: 0 };
  return {
    rowsRead: rows.length,
    rowsChanged: changed,
    alerts: rules.alerts,
    details: { inserted, timeFilled, alreadyThere: existing.length - timeFilled, outOfScope, rejected: rejected.slice(0, 200), rejectedCount: rejected.length },
  };
}

// ---------------------------------------------------------------------------
// W2–W5 – one shared path. W3 adds Rule 8 (Curing Log not updated).
// ---------------------------------------------------------------------------
export const rulesJob = (by: string) => () => runAll(by);

export async function curingLogWatch(): Promise<JobResult> {
  const rules = await runAll("job:W3");
  const now = new Date();
  const settings = await getSettings();
  const from = settings.alertsEnabledFrom;
  const conditions: Condition[] = [];
  const lines = from ? await prisma.line.findMany({ where: { inScope: true, active: true } }) : [];
  for (const line of lines) {
    const drums = { lineId: line.id, isCuringItem: true };
    const [last, running] = await Promise.all([
      prisma.curingLog.findFirst({ where: { drum: { lineId: line.id } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.drum.findFirst({ where: { ...drums, unloadedAt: { gte: new Date(now.getTime() - settings.lineRunningWindowHours * HOUR) } }, select: { id: true } }),
    ]);
    if (!running) continue;
    // Silence is counted from the first drum unloaded after the last curing entry, so a line that
    // restarts after a stoppage does not alert on its first drum.
    const since = new Date(Math.max(last?.createdAt.getTime() ?? 0, from!.getTime()));
    const waiting = await prisma.drum.findFirst({ where: { ...drums, unloadedAt: { gt: since } }, orderBy: { unloadedAt: "asc" }, select: { unloadedAt: true } });
    const anchor = waiting?.unloadedAt;
    if (!anchor || hoursBetween(anchor, now) < settings.curingLogSilenceHours) continue;
    conditions.push({
      trigger: "CURING_LOG_NOT_UPDATED",
      objectType: "LINE",
      // The start of the silence is part of the key so the next silence on this line can alert again.
      objectId: `${line.id}:${anchor.toISOString()}`,
      anchors: { FROM_LAST_CURING_ENTRY: anchor },
      ref: line.name,
      text: `${line.name} · last curing entry ${fmtDateTime(last?.createdAt)} · drums waiting since ${fmtDateTime(anchor)} (${fmtDuration(hoursBetween(anchor, now))})`,
    });
  }
  const { alerts } = await escalate(["CURING_LOG_NOT_UPDATED"], conditions, now, settings);
  return { ...rules, alerts: rules.alerts + alerts };
}

// ---------------------------------------------------------------------------
// W6 – Rule 9: a shift that has ended with no boiler reading.
// ---------------------------------------------------------------------------
export async function boilerWatch(): Promise<JobResult> {
  const now = new Date();
  const settings = await getSettings();
  const from = settings.alertsEnabledFrom;
  const today = istDay(now);
  // shortcut: looks back 3 days; an older missed reading is closed as resolved. Widen if escalation delays grow past 2 days.
  const days = [0, 1, 2, 3].map((n) => new Date(today.getTime() - n * 24 * HOUR));
  const [boilers, shifts, readings] = await Promise.all([
    prisma.boiler.findMany({ where: { active: true } }),
    prisma.shiftDef.findMany({ where: { active: true } }),
    prisma.boilerReading.findMany({ where: { date: { gte: days[3] } }, select: { boilerId: true, date: true, shiftId: true } }),
  ]);
  const have = new Set(readings.map((r) => `${r.boilerId}|${r.date.getTime()}|${r.shiftId}`));
  const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const conditions: Condition[] = [];
  for (const day of days)
    for (const s of shifts) {
      // The night shift ends on the next day; its reading belongs to the day it started.
      const length = (mins(s.endTime) - mins(s.startTime) + 1440) % 1440 || 1440;
      const end = new Date(istDayStart(day).getTime() + (mins(s.startTime) + length) * 60_000);
      if (end > now || !from || end < from) continue;
      for (const b of boilers) {
        if (have.has(`${b.id}|${day.getTime()}|${s.id}`)) continue;
        conditions.push({
          trigger: "BOILER_READING_MISSED",
          objectType: "BOILER_SHIFT",
          objectId: `${b.id}:${day.toISOString().slice(0, 10)}:${s.code}`,
          anchors: { FROM_SHIFT_END: end },
          ref: `${b.name} ${s.name} ${fmtDateOnly(day)}`,
          text: `${b.name} · ${s.name} shift · ${fmtDateOnly(day)}`,
        });
      }
    }
  const { alerts } = await escalate(["BOILER_READING_MISSED"], conditions, now, settings);
  return { rowsRead: readings.length, rowsChanged: 0, alerts, details: { missed: conditions.length } };
}

// ---------------------------------------------------------------------------
// W7 – daily MD summary (guide 9.4). Once per IST day.
// ---------------------------------------------------------------------------
export async function mdSummary(): Promise<JobResult> {
  const now = new Date();
  const settings = await getSettings();
  const today = istDay(now);
  const todayStart = istDayStart(today);
  const yesterday = new Date(today.getTime() - 24 * HOUR);
  const yStart = istDayStart(yesterday);
  if (await prisma.alert.findFirst({ where: { trigger: "DAILY_MD_SUMMARY", queuedAt: { gte: todayStart } }, select: { id: true } }))
    return { rowsRead: 0, rowsChanged: 0, alerts: 0, details: { skipped: "Already sent today" } };

  const inScope = { line: { inScope: true } };
  const notSent = ["PASSED", "REQUISITION_RAISED"] as const;
  const [md, lines, byStatus, yDrums, oldestPass, sent, firstCycle, level3, failedMessages] = await Promise.all([
    prisma.responsibility.findMany({ where: { area: "MD", active: true, person: { active: true } }, include: { person: true } }),
    prisma.line.findMany({ where: { inScope: true }, orderBy: { name: "asc" } }),
    prisma.drum.groupBy({ by: ["status"], where: inScope, _count: true }),
    prisma.drum.findMany({
      where: { ...inScope, isCuringItem: true, unloadDate: yesterday },
      select: { lineId: true, unloadedAt: true, status: true, curingLogs: { orderBy: { curingStartAt: "asc" }, take: 1, select: { curingStartAt: true } } },
    }),
    prisma.hotSetTest.findFirst({ where: { result: "PASS", curingLog: { lotStatus: { in: [...notSent] } } }, orderBy: { testedAt: "asc" }, select: { testedAt: true } }),
    prisma.curingLog.aggregate({ where: { sentDate: { gte: yStart, lt: todayStart } }, _sum: { lengthM: true } }),
    prisma.curingLog.findMany({ where: { cycleNo: 1, testResult: { not: null }, curingStartAt: { gte: new Date(now.getTime() - 30 * 24 * HOUR) } }, select: { testResult: true } }),
    prisma.escalation.count({ where: { level: { gte: 3 }, resolvedAt: null } }),
    prisma.alert.count({ where: { status: "FAILED", queuedAt: { gte: yStart } } }),
  ]);

  const n = (...statuses: string[]) => byStatus.filter((s) => statuses.includes(s.status)).reduce((sum, s) => sum + s._count, 0);
  const perLine = lines.map((l) => {
    const c = compliance(
      yDrums.filter((d) => d.lineId === l.id).map((d) => ({ unloadedAt: d.unloadedAt, curingStartAt: d.curingLogs[0]?.curingStartAt ?? null, dataError: d.status === "DATA_ERROR" })),
      now,
      settings.curingStartLimitHours,
    );
    return `${l.name} ${fmtPct(c.pct)} (${c.onTime}/${c.due}${c.unknownTime ? `, time unknown ${c.unknownTime}` : ""})`;
  });
  const text = [
    `📊 Curing – daily summary ${fmtDateOnly(today)}`,
    `Curing start on time, ${fmtDateOnly(yesterday)}: ${perLine.join(" · ") || "–"}`,
    `Missing now: ${n("MISSING")}`,
    `In curing: ${n("IN_CURING")} · Awaiting test: ${n("AWAITING_TEST")} · Test overdue: ${n("TEST_OVERDUE")}`,
    `Failed (hold / re-cure): ${n("FAILED")}`,
    `Passed, not sent: ${n(...notSent)}${oldestPass ? ` (oldest ${fmtDuration(hoursBetween(oldestPass.testedAt, now))})` : ""}`,
    `Sent yesterday: ${fmtKm(sent._sum.lengthM ?? 0)}`,
    `Pass rate (first cure, last 30 days): ${fmtPct(passRate(firstCycle.flatMap((r) => r.testResult ?? [])))}`,
    `Open level-3 escalations: ${level3}`,
    `Failed messages since yesterday: ${failedMessages}`,
    appUrl("/"),
  ].join("\n");

  let alerts = 0;
  for (const r of md) alerts += (await sendMessage({ trigger: "DAILY_MD_SUMMARY", person: r.person, text }, settings)).length;
  return { rowsRead: yDrums.length, rowsChanged: 0, alerts };
}

// ---------------------------------------------------------------------------
// A job that fails twice in a row alerts the admin (guide 10). There is no admin person list
// (admins are users, not persons), so it goes to the persons responsible for PRODUCTION_HEAD.
// ---------------------------------------------------------------------------
export async function alertJobFailure(job: string, runId: string, error: string) {
  const prior = await prisma.jobRun.findMany({ where: { job, id: { not: runId } }, orderBy: { startedAt: "desc" }, take: 2, select: { status: true } });
  // Only on the second failure, not on every one after it.
  if (prior[0]?.status !== "FAILED" || prior[1]?.status === "FAILED") return;
  const [settings, heads] = await Promise.all([
    getSettings(),
    prisma.responsibility.findMany({ where: { area: "PRODUCTION_HEAD", active: true, person: { active: true } }, include: { person: true } }),
  ]);
  const text = renderAlert("JOB_FAILURE", null, [{ text: `${job}: ${error.slice(0, 200)}` }]);
  for (const r of heads) await sendMessage({ trigger: "JOB_FAILURE", person: r.person, text, objectRefs: [job] }, settings);
}

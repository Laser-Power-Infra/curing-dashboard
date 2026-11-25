// Rules engine – public contract (guide Section 5). Screens import ONLY from "@/services/rules".
// Pure functions take plain rows plus `now`, so they are tested without a database.
import type { DrumStatus, TestResult, TimeCheck } from "@/generated/prisma/enums";
import { fmtTime, istDayStart } from "@/lib/format";

const HOUR = 3_600_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Rule 3 – matching (guide 5.3, as amended on 24-Nov-26)
//  - The Grid entry ID is the key. The same drum no can be unloaded twice on one day
//    (drum 879 on 14-Nov, after rewinding): both rows are valid and each needs its own
//    curing entry and its own 6-hour check.
//  - A curing row already linked to a drum (by a person or an earlier run) is never re-matched.
//  - Auto-match: first unlinked curing row with the same drum no whose start is after this
//    drum's unload and before the next unload of the same drum no. A curing row is used once.
//  - Unload time unknown (date only): no 6-hour check, never Missing. Auto-match only when it
//    is unambiguous; two unknown-time drums with the same drum no on the same day are a
//    DATA_ERROR for a person to link.
// ---------------------------------------------------------------------------
export type MatchDrum = {
  id: string;
  drumNo: string;
  /** IST calendar day of unload, as UTC midnight (the @db.Date value). */
  unloadDate: Date;
  /** null = time unknown. */
  unloadedAt: Date | null;
};
export type MatchLog = { id: string; coreDrumNo: string; curingStartAt: Date; drumId: string | null };
export type MatchOutcome =
  | { kind: "PENDING" } // not matched, still within the limit
  | { kind: "MISSING"; hoursSinceUnload: number }
  | { kind: "CURED"; logId: string }
  | { kind: "LATE"; logId: string; hoursLate: number }
  | { kind: "MATCHED_TIME_UNKNOWN"; logId: string } // matched, but on-time / late can't be judged
  | { kind: "TIME_UNKNOWN" } // not matched, no unload time: no 6-hour check
  | { kind: "DATA_ERROR" };

const drumKey = (s: string) => s.trim().toUpperCase();

/** Pass only in-scope curing-item drums. Returns one outcome per drum id. */
export function matchDrums(drums: MatchDrum[], logs: MatchLog[], now: Date, limitHours: number): Map<string, MatchOutcome> {
  const out = new Map<string, MatchOutcome>();
  const limitMs = limitHours * HOUR;

  const linked = new Map<string, MatchLog>(); // drum id → its first linked curing row
  const free = new Map<string, MatchLog[]>(); // drum no → unlinked curing rows, oldest first
  for (const l of [...logs].sort((a, b) => a.curingStartAt.getTime() - b.curingStartAt.getTime())) {
    if (l.drumId) {
      if (!linked.has(l.drumId)) linked.set(l.drumId, l);
    } else {
      const k = drumKey(l.coreDrumNo);
      free.set(k, [...(free.get(k) ?? []), l]);
    }
  }

  const byNo = new Map<string, MatchDrum[]>();
  for (const d of drums) byNo.set(drumKey(d.drumNo), [...(byNo.get(drumKey(d.drumNo)) ?? []), d]);

  // Unknown time: the day start is the earliest the drum can have been unloaded.
  const at = (d: MatchDrum) => (d.unloadedAt ?? istDayStart(d.unloadDate)).getTime();
  const matched = (d: MatchDrum, l: MatchLog): MatchOutcome => {
    if (!d.unloadedAt) return { kind: "MATCHED_TIME_UNKNOWN", logId: l.id };
    const hoursLate = (l.curingStartAt.getTime() - d.unloadedAt.getTime() - limitMs) / HOUR;
    return hoursLate > 0 ? { kind: "LATE", logId: l.id, hoursLate } : { kind: "CURED", logId: l.id };
  };

  for (const [no, group] of byNo) {
    group.sort((a, b) => at(a) - at(b));
    const rows = free.get(no) ?? [];
    const used = new Set<string>();
    for (const d of group) {
      const own = linked.get(d.id);
      if (own) {
        out.set(d.id, matched(d, own));
        continue;
      }
      const sameDay = group.filter((o) => o !== d && !linked.has(o.id) && o.unloadDate.getTime() === d.unloadDate.getTime());
      if (sameDay.length && (!d.unloadedAt || sameDay.some((o) => !o.unloadedAt))) {
        out.set(d.id, { kind: "DATA_ERROR" });
        continue;
      }
      const from = at(d);
      // A drum without a time cannot be ordered against same-day drums, so only later days bound it.
      const later = group.filter((o) => (d.unloadedAt ? at(o) > from : o.unloadDate.getTime() > d.unloadDate.getTime()));
      const next = Math.min(...later.map(at)); // Infinity when there is no later unload
      const row = rows.find((l) => {
        const t = l.curingStartAt.getTime();
        return !used.has(l.id) && (d.unloadedAt ? t > from : t >= from) && t < next;
      });
      if (row) {
        used.add(row.id);
        out.set(d.id, matched(d, row));
      } else if (!d.unloadedAt) {
        out.set(d.id, { kind: "TIME_UNKNOWN" });
      } else {
        const hoursSinceUnload = (now.getTime() - from) / HOUR;
        out.set(d.id, hoursSinceUnload > limitHours ? { kind: "MISSING", hoursSinceUnload } : { kind: "PENDING" });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rules 4 and 5 – curing time and test due
// ---------------------------------------------------------------------------
export type RecipeHours = { approvedCuringHrs: number; waitBeforeTestHrs: number };
export type CuringFields = {
  plannedCuringHrs: number | null;
  actualCuringHrs: number | null; // null until curing has ended
  hoursDeviation: number | null;
  timeCheck: TimeCheck | null; // NO_RECIPE when recipe is null; otherwise null until ended
  testDueAt: Date | null;
};
/** `recipe` must be an in-use, Approved recipe or null. */
export function computeCuringFields(curingStartAt: Date, curingEndAt: Date | null, recipe: RecipeHours | null): CuringFields {
  const plannedCuringHrs = recipe?.approvedCuringHrs ?? null;
  const actualCuringHrs = curingEndAt ? round2((curingEndAt.getTime() - curingStartAt.getTime()) / HOUR) : null;
  const known = actualCuringHrs != null && plannedCuringHrs != null;
  return {
    plannedCuringHrs,
    actualCuringHrs,
    hoursDeviation: known ? round2(actualCuringHrs - plannedCuringHrs) : null,
    timeCheck: !recipe ? "NO_RECIPE" : known ? (actualCuringHrs >= plannedCuringHrs ? "OK" : "UNDER_CURED") : null,
    testDueAt: curingEndAt && recipe ? new Date(curingEndAt.getTime() + recipe.waitBeforeTestHrs * HOUR) : null,
  };
}

/** The in-use, Approved recipe for a compound + product, or null (guide 3.5). */
export async function findRecipe(
  compound: string,
  productId: string,
): Promise<{ id: string; curingType: string; approvedCuringHrs: number; waitBeforeTestHrs: number } | null> {
  // Loaded on demand so the pure functions above can be imported without a database.
  return (await import("./run")).findRecipe(compound, productId);
}

// ---------------------------------------------------------------------------
// Guide 5.9 – one pipeline status per drum, from its latest curing cycle
// ---------------------------------------------------------------------------
export type StatusInput = {
  isCuringItem: boolean;
  match: MatchOutcome["kind"];
  /** Latest cycle, or null when no curing row is linked. */
  latest: {
    curingEndAt: Date | null;
    testDueAt: Date | null;
    testResult: TestResult | null;
    onOpenRequisition: boolean;
    sentDate: Date | null;
  } | null;
};
export function deriveDrumStatus(input: StatusInput, now: Date, testOverdueGraceHours: number): DrumStatus {
  const { latest: l } = input;
  if (!input.isCuringItem) return "NOT_CURING_ITEM";
  if (input.match === "DATA_ERROR") return "DATA_ERROR";
  if (!l) return input.match === "MISSING" ? "MISSING" : "MADE";
  if (l.sentDate) return "SENT";
  if (l.testResult === "FAIL") return "FAILED";
  if (l.testResult === "PASS") return l.onOpenRequisition ? "REQUISITION_RAISED" : "PASSED";
  if (!l.curingEndAt) return "IN_CURING";
  // No recipe → no test due time → never overdue; the No-recipe alert covers it.
  return l.testDueAt && now.getTime() > l.testDueAt.getTime() + testOverdueGraceHours * HOUR ? "TEST_OVERDUE" : "AWAITING_TEST";
}

// ---------------------------------------------------------------------------
// Guide 5.10 and 5.11 – compliance and pass rate
// ---------------------------------------------------------------------------
export type ComplianceRow = { unloadedAt: Date | null; curingStartAt: Date | null; dataError: boolean };
export type Compliance = { due: number; onTime: number; pct: number | null; unknownTime: number };
/** Pass curing-item drums for one line / day / shift. `pct` is null when nothing is due. */
export function compliance(rows: ComplianceRow[], now: Date, limitHours: number): Compliance {
  let due = 0;
  let onTime = 0;
  let unknownTime = 0;
  for (const r of rows) {
    if (!r.unloadedAt) unknownTime++;
    if (!r.unloadedAt || r.dataError) continue;
    const deadline = r.unloadedAt.getTime() + limitHours * HOUR;
    if (now.getTime() <= deadline) continue;
    due++;
    if (r.curingStartAt && r.curingStartAt.getTime() <= deadline) onTime++;
  }
  return { due, onTime, pct: due ? (onTime / due) * 100 : null, unknownTime };
}

/** passed ÷ (passed + failed) × 100 over first-cycle results; null when there are none. */
export function passRate(firstCycleResults: TestResult[]): number | null {
  if (!firstCycleResults.length) return null;
  return (firstCycleResults.filter((r) => r === "PASS").length / firstCycleResults.length) * 100;
}

/** Which shift an instant falls in. `shifts` are ShiftDef rows (IST "HH:mm"; night may cross midnight). */
export function shiftOf(at: Date, shifts: { code: string; startTime: string; endTime: string }[]): string | null {
  const t = fmtTime(at); // zero-padded "HH:mm" compares correctly as text
  const hit = shifts.find((s) => (s.startTime < s.endTime ? t >= s.startTime && t < s.endTime : t >= s.startTime || t < s.endTime));
  return hit?.code ?? null;
}

/**
 * True for insulated cores and covered conductors (XLPE / SIO); false for compact or bare
 * conductors, which are not cured (Grid ID 331105). Used when a drum's product is not in the
 * Product Master; the master's isCuringItem flag wins when the product is known.
 */
export function looksLikeCuringItem(coreItem: string): boolean {
  return /INSULATED|COVERED|XLPE|\bSIO/i.test(coreItem);
}

// ---------------------------------------------------------------------------
// Running the rules against the database
// ---------------------------------------------------------------------------
/**
 * Re-run rules 1–7 now: match drums, refresh every AUTO column (drum status, curing log
 * computed fields, tracker rows), open / resolve escalations and send due alerts.
 * Idempotent. Never writes MANUAL columns. Call it after every form save that changes a drum,
 * curing row, test or requisition; never throws for a failed WhatsApp send.
 * `by` = the user's email, or "job:W2" etc.
 */
export async function runRules(by: string): Promise<void> {
  await (await import("./run")).runAll(by);
}

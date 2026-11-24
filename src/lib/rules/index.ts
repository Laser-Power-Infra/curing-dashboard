// Rules engine – public contract (guide Section 5). Screens import ONLY from "@/lib/rules".
// Pure functions take plain rows plus `now`, so they are tested without a database.
import type { DrumStatus, TestResult, TimeCheck } from "@/generated/prisma/enums";

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

/** Pass only in-scope curing-item drums. Returns one outcome per drum id. */
export function matchDrums(drums: MatchDrum[], logs: MatchLog[], now: Date, limitHours: number): Map<string, MatchOutcome> {
  void drums, logs, now, limitHours;
  throw new Error("not implemented");
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
  void curingStartAt, curingEndAt, recipe;
  throw new Error("not implemented");
}

/** The in-use, Approved recipe for a compound + product, or null (guide 3.5). */
export async function findRecipe(
  compound: string,
  productId: string,
): Promise<{ id: string; curingType: string; approvedCuringHrs: number; waitBeforeTestHrs: number } | null> {
  void compound, productId;
  throw new Error("not implemented");
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
  void input, now, testOverdueGraceHours;
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Guide 5.10 and 5.11 – compliance and pass rate
// ---------------------------------------------------------------------------
export type ComplianceRow = { unloadedAt: Date | null; curingStartAt: Date | null; dataError: boolean };
export type Compliance = { due: number; onTime: number; pct: number | null; unknownTime: number };
/** Pass curing-item drums for one line / day / shift. `pct` is null when nothing is due. */
export function compliance(rows: ComplianceRow[], now: Date, limitHours: number): Compliance {
  void rows, now, limitHours;
  throw new Error("not implemented");
}

/** passed ÷ (passed + failed) × 100 over first-cycle results; null when there are none. */
export function passRate(firstCycleResults: TestResult[]): number | null {
  void firstCycleResults;
  throw new Error("not implemented");
}

/** Which shift an instant falls in. `shifts` are ShiftDef rows (IST "HH:mm"; night may cross midnight). */
export function shiftOf(at: Date, shifts: { code: string; startTime: string; endTime: string }[]): string | null {
  void at, shifts;
  throw new Error("not implemented");
}

/**
 * True for insulated cores and covered conductors (XLPE / SIO); false for compact or bare
 * conductors, which are not cured (Grid ID 331105). Used when a drum's product is not in the
 * Product Master; the master's isCuringItem flag wins when the product is known.
 */
export function looksLikeCuringItem(coreItem: string): boolean {
  void coreItem;
  throw new Error("not implemented");
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
  void by;
  throw new Error("not implemented");
}

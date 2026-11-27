// What a drum needs next, for the operator home. Pure: no database, so it is tested with plain rows.
// Drum.status (written by the rules engine) decides the stage; nothing here re-derives pass / fail.
import type { DrumStatus } from "@/generated/prisma/enums";
import { fmtDateTime, fmtDuration, fmtTime, istDay } from "@/lib/format";
import { L } from "@/lib/labels";

const HOUR = 3_600_000;
/** A card turns amber this many hours before its deadline. */
export const SOON_HOURS = 2;

export type Action = "load" | "endCuring" | "test" | "requisition" | "dispatch" | "none";
export type ActionTone = "red" | "amber" | "green";
/** Whose card it is: the curing team, the lab or the transfer team. */
export type Kind = "curing" | "lab" | "transfer";

export type ActionDrum = { status: DrumStatus; unloadedAt: Date | null };
/** The drum's latest curing cycle, or null when it has none. */
export type ActionLog = {
  curingStartAt: Date;
  curingEndAt: Date | null;
  plannedCuringHrs: number | null;
  testDueAt: Date | null;
  /** When the latest hot set test of this cycle was done. */
  testedAt: Date | null;
  /** When its open requisition was raised. */
  requisitionRaisedAt: Date | null;
};
export type ActionSettings = { curingStartLimitHours: number; testOverdueGraceHours: number };

export type NextAction = {
  /** Journey step the drum is waiting for: 0 Unloaded, 1 In tank, 2 Curing done, 3 Tested, 4 Passed, 5 Requisition, 6 Sent (7 = all done). Earlier steps are done. */
  step: number;
  action: Action;
  deadline: Date | null;
  /** When the current wait began (for "X h waiting" and the progress bar). */
  since: Date | null;
  tone: ActionTone;
  /** Plain-words line: what happened and what it asks for. */
  trigger: string;
  kind: Kind;
};

/** Time only for today (IST), date and time otherwise. */
export const when = (d: Date, now: Date) => (istDay(d).getTime() === istDay(now).getTime() ? fmtTime(d) : fmtDateTime(d));

export const kindOf = (status: DrumStatus): Kind =>
  status === "AWAITING_TEST" || status === "TEST_OVERDUE" ? "lab" : status === "PASSED" || status === "REQUISITION_RAISED" ? "transfer" : "curing";

/** `2 h 15 m बाकी / left` or `3 h 05 m देर / late`. */
export function countdownText(deadlineMs: number, nowMs: number): string {
  const left = deadlineMs - nowMs;
  return `${fmtDuration(Math.abs(left) / HOUR)} ${left < 0 ? L.late : L.left}`;
}

export function nextAction(drum: ActionDrum, log: ActionLog | null, now: Date, settings: ActionSettings): NextAction {
  const kind = kindOf(drum.status);
  const t = (d: Date) => when(d, now);
  // Red once past the deadline (plus any grace), amber from SOON_HOURS before it.
  const toneFor = (deadline: Date | null, graceHours = 0): ActionTone => {
    if (!deadline) return "green";
    const left = deadline.getTime() - now.getTime();
    return left < -graceHours * HOUR ? "red" : left <= SOON_HOURS * HOUR ? "amber" : "green";
  };
  const out = (step: number, action: Action, tone: ActionTone, trigger: string, deadline: Date | null = null, since: Date | null = null): NextAction => ({
    step,
    action,
    deadline,
    since,
    tone,
    trigger,
    kind,
  });

  switch (drum.status) {
    case "MADE":
    case "MISSING": {
      if (!drum.unloadedAt) return out(1, "load", "green", "Unload time not known → put in tank");
      const deadline = new Date(drum.unloadedAt.getTime() + settings.curingStartLimitHours * HOUR);
      return out(1, "load", drum.status === "MISSING" ? "red" : toneFor(deadline), `Unloaded ${t(drum.unloadedAt)} → put in tank by ${t(deadline)}`, deadline, drum.unloadedAt);
    }
    case "IN_CURING": {
      if (!log) return out(2, "none", "green", "In curing");
      if (log.plannedCuringHrs == null) return out(2, "endCuring", "green", `Curing started ${t(log.curingStartAt)} → no recipe, end time not known`, null, log.curingStartAt);
      const deadline = new Date(log.curingStartAt.getTime() + log.plannedCuringHrs * HOUR);
      // "end at", not "end by": taking the drum out earlier makes it under-cured.
      return out(2, "endCuring", toneFor(deadline), `Curing started ${t(log.curingStartAt)} → end at ${t(deadline)} (recipe ${log.plannedCuringHrs} h)`, deadline, log.curingStartAt);
    }
    case "AWAITING_TEST":
    case "TEST_OVERDUE": {
      const since = log?.curingEndAt ?? null;
      const due = log?.testDueAt ?? null;
      if (!due) return out(3, "test", drum.status === "TEST_OVERDUE" ? "red" : "green", `Curing ended ${since ? t(since) : "–"} → test (no recipe, so no due time)`, null, since);
      // The status turns to Test overdue only after the grace hours, so the card is amber until then.
      return out(3, "test", drum.status === "TEST_OVERDUE" ? "red" : toneFor(due, settings.testOverdueGraceHours), `Test due ${fmtDateTime(due)}`, due, since);
    }
    case "FAILED":
      return out(4, "none", "red", `Failed ${log?.testedAt ? t(log.testedAt) : ""} → hold / re-cure`.replace("  ", " "), null, log?.testedAt ?? null);
    case "PASSED":
      return out(5, "requisition", "green", `Passed ${log?.testedAt ? t(log.testedAt) : ""} → raise requisition`.replace("  ", " "), null, log?.testedAt ?? null);
    case "REQUISITION_RAISED": {
      const raised = log?.requisitionRaisedAt ?? null;
      return out(6, "dispatch", "green", `Requisition raised ${raised ? t(raised) : ""} → dispatch to Polypark`.replace("  ", " "), null, raised);
    }
    case "DATA_ERROR":
      return out(1, "none", "red", "Data error → the office must link this drum to its curing row");
    case "SENT":
      return out(7, "none", "green", "Sent to Polypark");
    default:
      return out(0, "none", "green", "Not a curing item");
  }
}

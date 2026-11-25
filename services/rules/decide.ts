// Pure decisions behind escalations and the Missing Drum Tracker (no database), so they can be tested.
import type { EscalationAnchor, TrackerStatus } from "@/generated/prisma/enums";
import type { MatchOutcome } from "./index";

export type LevelRule = { level: number; anchor: EscalationAnchor; delayMinutes: number };
export type Anchors = Partial<Record<EscalationAnchor, Date | null>>;

/** Levels of one trigger that are due now for one object and have not fired yet (guide 9.2). */
export function dueLevels(rules: LevelRule[], anchors: Anchors, fired: ReadonlySet<number>, now: Date): { level: number; dueAt: Date }[] {
  return rules.flatMap((r) => {
    const anchor = anchors[r.anchor];
    if (!anchor || fired.has(r.level)) return [];
    const dueAt = new Date(anchor.getTime() + r.delayMinutes * 60_000);
    return dueAt <= now ? [{ level: r.level, dueAt }] : [];
  });
}

/** The AUTO columns of a tracker row. Reason, remarks and MD remarks are never part of this (guide 3.8). */
export type TrackerAuto = {
  status: TrackerStatus;
  curingLogId: string | null;
  curingStartAt: Date | null;
  hoursLate: number | null;
  closedAt: Date | null;
};

/**
 * What the tracker row of a drum should hold now, or null when the drum needs no row.
 * `outcome` is null for a drum that is no longer a curing item.
 */
export function trackerAuto(existing: TrackerAuto | null, outcome: MatchOutcome | null, curingStartAt: Date | null, now: Date): TrackerAuto | null {
  const closedAt = existing?.closedAt ?? now;
  switch (outcome?.kind) {
    case "MISSING":
    case "DATA_ERROR":
      return { status: outcome.kind, curingLogId: null, curingStartAt: null, hoursLate: null, closedAt: null };
    case "LATE":
      return { status: "LATE", curingLogId: outcome.logId, curingStartAt, hoursLate: Math.round(outcome.hoursLate * 100) / 100, closedAt };
    case "CURED":
    case "MATCHED_TIME_UNKNOWN":
      // A drum cured on time only keeps a row if it was on the tracker before.
      return existing && { status: "CURED", curingLogId: outcome.logId, curingStartAt, hoursLate: null, closedAt };
    default:
      // No longer missing and not matched (unload time corrected, not a curing item): close, keep the record.
      return (
        existing && {
          status: existing.status,
          curingLogId: existing.curingLogId,
          curingStartAt: existing.curingStartAt,
          hoursLate: existing.hoursLate,
          closedAt,
        }
      );
  }
}

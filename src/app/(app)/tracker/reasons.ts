// Kept apart from shared.ts so the browser-side editor can import it without pulling in sign-in code.
import type { DelayReason } from "@/generated/prisma/enums";

export const REASONS: Record<DelayReason, string> = {
  TANK_FULL: "Tank full",
  BOILER_DOWN: "Boiler down",
  NO_MANPOWER: "No manpower",
  DRUM_ON_HOLD: "Drum on hold",
  OTHER: "Other",
};

export type TrackerField = "reason" | "remarks" | "mdRemarks";

// One place for the tracker's manual-column rules, used by the pages and by the save action.
import { can, type SessionUser } from "@/lib/auth";

export { REASONS, type TrackerField } from "./tracker-reasons";
import type { TrackerField } from "./tracker-reasons";

export const TRACKER_FIELDS: readonly string[] = ["reason", "remarks", "mdRemarks"];

/** Guide 11: MD Remarks are the MD's; a closed row needs the production head or admin. */
export function mayEditTracker(user: SessionUser, field: TrackerField, closed: boolean) {
  // Late rows are closed rows, and they are the ones the MD comments on, so MD Remarks stay open to the MD.
  if (field === "mdRemarks") return can(user, "mdRemarks");
  return can(user, closed ? "resolveDataError" : "trackerRemarks");
}

export const trackId = (trackNo: number) => `MDT-${String(trackNo).padStart(4, "0")}`;

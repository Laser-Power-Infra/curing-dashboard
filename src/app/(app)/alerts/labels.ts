// Plain-language names for alert triggers (guide 9.1). Used by Alerts, Settings and How to Use.
import type { AlertTrigger } from "@/generated/prisma/enums";

export const TRIGGER_LABEL: Record<AlertTrigger, string> = {
  DRUM_NOT_IN_CURING: "Drum not in curing",
  CURING_LOG_NOT_UPDATED: "Curing log not updated",
  UNDER_CURED: "Under-cured drum",
  TEST_OVERDUE: "Hot set test overdue",
  TEST_FAILED: "Hot set test failed",
  PASSED_NO_REQUISITION: "Passed, requisition not raised",
  BOILER_READING_MISSED: "Boiler reading missed",
  NO_RECIPE: "No approved recipe",
  DAILY_MD_SUMMARY: "Daily MD summary",
  JOB_FAILURE: "Background job failed",
  FEED_STALE: "Drum feed is old",
};

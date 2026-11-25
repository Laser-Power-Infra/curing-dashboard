// WhatsApp message texts (guide 9.3). Pure: no database.
import type { AlertTrigger } from "@/generated/prisma/enums";
import { fmtKm } from "@/lib/format";

export type AlertItem = { text: string; lengthM?: number };

const T: Partial<Record<AlertTrigger, { head: string; intro: (n: number) => string; foot: string; path: string }>> = {
  DRUM_NOT_IN_CURING: {
    head: "⚠️ Drums not in curing",
    intro: (n) => `${n} drum${n > 1 ? "s" : ""} past the curing start limit with no curing entry:`,
    foot: "Please load and enter in the Curing Dashboard.",
    path: "/tracker",
  },
  CURING_LOG_NOT_UPDATED: {
    head: "⚠️ Curing Log not updated",
    intro: () => "Line is running but no new curing entry:",
    foot: "Please enter the curing rows in the Curing Dashboard.",
    path: "/curing",
  },
  UNDER_CURED: {
    head: "⚠️ Under-cured drums",
    intro: (n) => `${n} drum${n > 1 ? "s" : ""} cured for less than the approved hours:`,
    foot: "Please hold and re-cure, or correct the curing entry.",
    path: "/curing",
  },
  NO_RECIPE: {
    head: "⚠️ No approved curing recipe",
    intro: (n) => `${n} curing entr${n > 1 ? "ies have" : "y has"} no in-use, approved recipe:`,
    foot: "Please add or approve the recipe in the Curing Recipe Master.",
    path: "/settings",
  },
  TEST_OVERDUE: {
    head: "⚠️ Hot set test overdue",
    intro: (n) => `${n} lot${n > 1 ? "s" : ""} past test due with no result:`,
    foot: "Please test and enter the result in the Curing Dashboard.",
    path: "/tests",
  },
  TEST_FAILED: {
    head: "❌ Hot set FAILED – hold / re-cure",
    intro: (n) => `${n} lot${n > 1 ? "s" : ""} failed. Do not send:`,
    foot: "Please re-cure and test again.",
    path: "/tests",
  },
  PASSED_NO_REQUISITION: {
    head: "✅ Hot set PASSED – send to Polypark",
    intro: () => "",
    foot: "Please raise the transfer requisition (Kharagpur → Polypark).",
    path: "/transfers",
  },
  BOILER_READING_MISSED: {
    head: "⚠️ Boiler reading missed",
    intro: () => "No reading entered for:",
    foot: "Please enter the reading in the Boiler Log.",
    path: "/boiler",
  },
  JOB_FAILURE: {
    head: "⚠️ Curing Dashboard job failed twice in a row",
    intro: () => "",
    foot: "Please check the job monitor.",
    path: "/settings",
  },
};

export const appUrl = (path: string) => `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}${path}`;

/** One grouped message for one person and one trigger. */
export function renderAlert(trigger: AlertTrigger, level: number | null, items: AlertItem[]): string {
  const t = T[trigger];
  if (!t) throw new Error(`No message template for ${trigger}`);
  const total = items.reduce((s, i) => s + (i.lengthM ?? 0), 0);
  const isPassed = trigger === "PASSED_NO_REQUISITION";
  return [
    t.head,
    t.intro(items.length),
    ...items.map((i) => (isPassed ? i.text : `• ${i.text}`)),
    isPassed ? `Total ${fmtKm(total)}. ${t.foot}` : t.foot,
    level ? `Level ${level} · ${appUrl(t.path)}` : appUrl(t.path),
  ]
    .filter(Boolean)
    .join("\n");
}

// URL helpers shared by the Overview, Drum list and Missing Drum Tracker.
import { istDay, istDayStart } from "@/lib/format";

export type { SP } from "@/lib/table";
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function qs(params: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Start of today (IST) or of this week (Monday, IST) – for the "Sent" tiles. */
export function sentSince(kind: string | undefined, now: Date): Date | null {
  if (kind !== "today" && kind !== "week") return null;
  const today = istDay(now);
  const back = kind === "week" ? (today.getUTCDay() + 6) % 7 : 0;
  return istDayStart(new Date(today.getTime() - back * 86_400_000));
}

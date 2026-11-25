// URL helpers and the pager shared by the Overview, Drum list and Missing Drum Tracker.
import { LinkButton } from "@/components/ui";
import { istDay, istDayStart } from "@/lib/format";

export type SP = Record<string, string | string[] | undefined>;
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

export const PAGE_SIZE = 50;
export const pageOf = (v: string | string[] | undefined) => Math.max(1, Math.floor(Number(one(v))) || 1);

export function Pager({ path, params, page, total }: { path: string; params: Record<string, string | number | undefined>; page: number; total: number }) {
  if (total <= PAGE_SIZE) return null;
  const last = Math.ceil(total / PAGE_SIZE);
  return (
    <nav aria-label="Pages" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <span>
        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <span className="flex gap-2">
        {page > 1 && <LinkButton variant="secondary" href={`${path}${qs({ ...params, page: page - 1 })}`}>Previous</LinkButton>}
        {page < last && <LinkButton variant="secondary" href={`${path}${qs({ ...params, page: page + 1 })}`}>Next</LinkButton>}
      </span>
    </nav>
  );
}

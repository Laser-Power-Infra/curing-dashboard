// One drum on the operator home: what to do, by when, who is responsible, and one big button.
import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDuration, fmtKm, hoursBetween } from "@/lib/format";
import { L } from "@/lib/labels";
import { countdownText, type NextAction } from "@/lib/next-action";
import { Bi, DrumInfo } from "@/components/ui";
import { Countdown } from "./countdown";
import { Ladder, type LadderLevel } from "./ladder";
import { StepBar } from "./step-bar";

const LOOK = {
  red: { label: L.actNow, frame: "border-red-300", band: "bg-red-50 text-red-900", dot: "bg-red-600", bar: "bg-red-600" },
  amber: { label: L.dueSoon, frame: "border-amber-200", band: "bg-amber-50 text-amber-950", dot: "bg-amber-500", bar: "bg-amber-500" },
  green: { label: L.allOk, frame: "border-slate-200", band: "bg-green-50 text-green-900", dot: "bg-green-600", bar: "bg-green-600" },
};

/** Big, thumb-sized button look for links. */
export const BIG_BTN =
  "flex min-h-14 w-full items-center justify-center rounded-lg bg-blue-700 px-5 py-2 text-center text-lg font-semibold text-(--on-solid) transition-colors hover:bg-blue-800 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
/** The same look for the submit button inside an <ActionForm className={BIG_FORM}> (its own button class cannot be changed). */
export const BIG_FORM = "[&_button]:min-h-14 [&_button]:w-full [&_button]:rounded-lg [&_button]:px-5 [&_button]:text-lg [&_button]:font-semibold";

export function DrumCard({
  drum,
  action: a,
  actionText,
  now,
  responsible,
  ladder,
  children,
}: {
  drum: { id: string; drumNo: string; line: string; lengthM: number | { toString(): string }; party: string | null; coreItem: string; product?: { code: string | null } | null };
  action: NextAction;
  /** The job in words, e.g. "Put in tank". */
  actionText: string;
  now: Date;
  responsible: string[];
  ladder: LadderLevel[];
  /** The big button, or nothing when this user may not do the step. */
  children?: ReactNode;
}) {
  const look = LOOK[a.tone];
  const pct = a.deadline && a.since ? Math.max(0, Math.min(100, (hoursBetween(a.since, now) / hoursBetween(a.since, a.deadline)) * 100)) : null;
  return (
    <article className={`flex h-full flex-col overflow-hidden rounded-xl border bg-white shadow-[0_1px_2px_rgb(0_0_0/0.06),0_4px_12px_-6px_rgb(0_0_0/0.12)] ${look.frame}`}>
      {/* What state, and how long: the two things read from across the floor. */}
      <div className={`flex items-center justify-between gap-3 px-4 py-2.5 ${look.band}`}>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className={`size-2.5 shrink-0 rounded-full ${look.dot}`} aria-hidden />
          <Bi text={look.label} />
        </span>
        <span className="text-right text-xl leading-6 font-bold tabular-nums">
          {a.deadline ? (
            <Countdown deadline={a.deadline.getTime()} initial={countdownText(a.deadline.getTime(), now.getTime())} />
          ) : a.since ? (
            <>
              {fmtDuration(hoursBetween(a.since, now))} <span className="text-sm font-medium">से इंतज़ार · waiting</span>
            </>
          ) : null}
        </span>
      </div>
      {pct != null && (
        <div className="h-1 bg-slate-100" aria-hidden>
          <div className={`h-full ${look.bar}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="shrink-0">
            <Link href={`/drums/${drum.id}`} className="text-3xl leading-9 font-bold tracking-tight text-slate-900 underline decoration-slate-300 decoration-2 underline-offset-4 hover:decoration-slate-500 focus-visible:outline-2 focus-visible:outline-blue-700">
              <span className="sr-only">Drum </span>
              {drum.drumNo}
            </Link>
            <p className="mt-0.5 text-sm whitespace-nowrap text-slate-600">
              {drum.line} · <span className="tabular-nums">{fmtKm(drum.lengthM)}</span>
            </p>
          </div>
          <div className="min-w-0 text-right">
            <DrumInfo drum={{ party: drum.party, coreItem: drum.coreItem, product: drum.product?.code ? { code: drum.product.code } : null }} compact />
          </div>
        </div>

        <div>
          <p className="text-xl leading-7 font-semibold text-slate-900">
            <Bi text={actionText} />
          </p>
          <p className="mt-0.5 text-base text-slate-700">{a.trigger}</p>
        </div>

        <StepBar current={a.step} late={a.tone === "red" ? a.step : null} />

        <div className="mt-auto space-y-3">
          <p className="text-sm text-slate-600">
            <Bi text={L.responsible} />: <span className="font-semibold text-slate-900">{responsible.join(", ") || "Nobody set"}</span>
          </p>
          <Ladder levels={ladder} now={now} />
          {children}
        </div>
      </div>
    </article>
  );
}

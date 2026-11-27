// The drum's journey as seven segments with the current step named. Server-safe (no hooks), so any page can use it.
import { L } from "@/lib/labels";
import { Bi } from "@/components/ui";

export const JOURNEY = [L.unloaded, L.inTank, L.curingDone, L.tested, L.passed, L.requisition, L.sent] as const;

/**
 * `current` = index of the step the drum is waiting for (steps before it are done; 7 = all done).
 * `late` = index of the step that is late, if any.
 */
export function StepBar({ current, late }: { current: number; late?: number | null }) {
  const done = current >= JOURNEY.length;
  const isLate = late === current;
  const english = (i: number) => JOURNEY[i].split(" / ").at(-1);
  return (
    <div role="img" aria-label={done ? "Journey complete" : `Step ${current + 1} of ${JOURNEY.length}: ${english(current)}${isLate ? ", late" : ""}`}>
      <div className="flex gap-1" aria-hidden>
        {JOURNEY.map((label, i) => (
          <span key={label} className={`h-2 flex-1 rounded-full ${i < current ? "bg-green-600" : i === current ? (isLate ? "bg-red-600" : "bg-blue-700") : "bg-slate-200"}`} />
        ))}
      </div>
      <p className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-sm" aria-hidden>
        <span className={`font-semibold ${isLate ? "text-red-800" : "text-slate-900"}`}>
          <span className="tabular-nums">{Math.min(current + 1, JOURNEY.length)}/{JOURNEY.length}</span> · <Bi text={done ? L.sent : JOURNEY[current]} />
        </span>
        {current + 1 < JOURNEY.length && (
          <span className="text-slate-600">
            फिर / then: <Bi text={JOURNEY[current + 1]} />
          </span>
        )}
      </p>
    </div>
  );
}

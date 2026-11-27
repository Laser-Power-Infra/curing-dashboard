// Who has been told about a late drum, and who is told next. Server-safe.
import type { EscalationAnchor } from "@/generated/prisma/enums";
import type { Anchors } from "@/services/rules/decide";
import { when } from "@/lib/next-action";

export type LadderLevel = { level: number; names: string[]; at: Date | null; fired: boolean };
export type LadderRule = { level: number; anchor: EscalationAnchor; delayMinutes: number; recipients: { name: string }[] };

/**
 * `rules` = the active EscalationRule rows of ONE trigger. `fired` = this object's open Escalation rows of that trigger.
 * Returns the fired levels, then the lowest level not fired yet (at anchor + delay) when `withNext` is set.
 */
export function ladderLevels(rules: LadderRule[], fired: { level: number; firedAt: Date | null }[], anchors: Anchors, withNext = true): LadderLevel[] {
  const names = (level: number) => rules.find((r) => r.level === level)?.recipients.map((p) => p.name) ?? [];
  const done = [...fired].sort((a, b) => a.level - b.level).map((f) => ({ level: f.level, names: names(f.level), at: f.firedAt, fired: true }));
  const next = [...rules].sort((a, b) => a.level - b.level).find((r) => anchors[r.anchor] && !fired.some((f) => f.level === r.level));
  const anchor = next && anchors[next.anchor];
  return next && anchor && withNext
    ? [...done, { level: next.level, names: names(next.level), at: new Date(anchor.getTime() + next.delayMinutes * 60_000), fired: false }]
    : done;
}

export function Ladder({ levels, now }: { levels: LadderLevel[]; now: Date }) {
  if (!levels.length) return null;
  return (
    <ol className="space-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800" aria-label="Who has been informed">
      {levels.map((l) => {
        const who = l.names.join(" + ") || `Level ${l.level}`;
        return (
          <li key={l.level} className={l.fired ? "" : "text-slate-600"}>
            {l.fired ? (
              <>
                <svg viewBox="0 0 16 16" className="mr-1 inline size-4 align-[-3px] text-green-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m3 8.5 3.2 3L13 4.5" /></svg>
                <span className="font-medium">{who}</span> को बताया / informed{l.at ? ` ${when(l.at, now)}` : ""}
              </>
            ) : (
              <>
                <svg viewBox="0 0 16 16" className="mr-1 inline size-4 align-[-3px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.3 1.5" /></svg>
                अगला / next: <span className="font-medium">{who}</span>
                {l.at ? ` at ${when(l.at, now)}` : ""}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// When a shift of an IST production date starts and ends. Shift times are IST "HH:mm"; the night shift ends next morning.
import { istDay, istDayStart } from "@/lib/format";

type Shift = { startTime: string; endTime: string };
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** `day` is the production date as a @db.Date value (UTC midnight). */
export function shiftWindow(day: Date, s: Shift): { start: Date; end: Date } {
  const start = istDayStart(day).getTime() + mins(s.startTime) * 60_000;
  const lengthMin = ((mins(s.endTime) - mins(s.startTime) + 1439) % 1440) + 1; // end <= start means next day
  return { start: new Date(start), end: new Date(start + lengthMin * 60_000) };
}

/** The production date and shift running at `now`. After midnight the night shift still belongs to yesterday. */
export function currentShift<S extends Shift>(now: Date, shifts: S[]): { day: Date; shift: S } | null {
  const today = istDay(now);
  for (const day of [today, new Date(today.getTime() - 86_400_000)])
    for (const shift of shifts) {
      const w = shiftWindow(day, shift);
      if (w.start <= now && now < w.end) return { day, shift };
    }
  return null;
}

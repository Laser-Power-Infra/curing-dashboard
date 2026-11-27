// Display and input helpers. All times are stored in UTC and shown in IST (guide 3, 7).
// IST has no daylight saving, so a fixed +05:30 offset is exact.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Num = number | string | { toString(): string } | null | undefined;
const toNum = (v: Num) => (v == null ? null : Number(v.toString()));
const pad = (n: number) => String(n).padStart(2, "0");

/** The same instant shifted so its UTC fields read as IST wall-clock fields. */
const ist = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

/** `24-Nov 14:30` */
export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "–";
  const t = ist(d);
  return `${pad(t.getUTCDate())}-${MONTHS[t.getUTCMonth()]} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** `24-Nov-26`. For a timestamp. For a date-only column (@db.Date) use fmtDateOnly. */
export function fmtDate(d: Date | null | undefined): string {
  return d ? fmtDateOnly(ist(d)) : "–";
}

/** `24-Nov-26` for a date-only column (@db.Date, stored as UTC midnight). */
export function fmtDateOnly(d: Date | null | undefined): string {
  if (!d) return "–";
  return `${pad(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
}

/** `14:30` */
export function fmtTime(d: Date | null | undefined): string {
  if (!d) return "–";
  const t = ist(d);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** Hours → `7 h 20 m` */
export function fmtDuration(hours: Num): string {
  const h = toNum(hours);
  if (h == null || Number.isNaN(h)) return "–";
  const mins = Math.round(Math.abs(h) * 60);
  return `${h < 0 ? "-" : ""}${Math.floor(mins / 60)} h ${pad(mins % 60)} m`;
}

export const hoursBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3_600_000;

/** Metres → `5,075 m` */
export function fmtM(m: Num): string {
  const n = toNum(m);
  return n == null ? "–" : `${Math.round(n).toLocaleString("en-IN")} m`;
}

/** Metres → `3.02 km` (guide 5.9: sum(length_m) / 1000, 2 decimals) */
export function fmtKm(m: Num): string {
  const n = toNum(m);
  return n == null ? "–" : `${(n / 1000).toFixed(2)} km`;
}

export function fmtPct(p: number | null | undefined): string {
  return p == null ? "–" : `${Math.round(p)}%`;
}

/** Value for <input type="datetime-local"> in IST: `2026-11-24T14:30` */
export function toIstInput(d: Date | null | undefined): string {
  return d ? ist(d).toISOString().slice(0, 16) : "";
}

/** Parse an <input type="datetime-local"> value typed in IST. Returns null if invalid. */
export function parseIstInput(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 16)}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The IST calendar day of an instant, as the UTC-midnight Date that @db.Date columns hold. */
export function istDay(d: Date): Date {
  return new Date(`${ist(d).toISOString().slice(0, 10)}T00:00:00Z`);
}

/** Parse `2026-11-24` (from <input type="date">) to the UTC-midnight Date that @db.Date columns hold. */
export function parseDateOnly(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The instant an IST calendar day (a @db.Date value) starts. */
export const istDayStart = (day: Date) => new Date(day.getTime() - IST_OFFSET_MS);

/** Item name → short size tag: "300 SQ. MM. CORE INSULATED 33kv (SIO/GENERAL)" → "300 sq mm · 33 kV". "" when the name has neither. */
export function sizeTag(itemName: string | null | undefined): string {
  const sq = itemName?.match(/(\d+(?:\.\d+)?)\s*SQ\.?\s*MM/i)?.[1];
  const kv = itemName?.match(/(\d+(?:\.\d+)?)\s*KV/i)?.[1];
  return [sq && `${sq} sq mm`, kv && `${kv} kV`].filter(Boolean).join(" · ");
}

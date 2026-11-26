// Pure helpers for the one-time Curing Sheet import (guide 4.3). The database side is services/sheet-sync.ts.

/** RFC 4180 CSV: quoted fields may hold commas, newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Rows as objects keyed by the header row, which is the first row holding `marker`. `_row` is the sheet row number. */
export function toRecords(rows: string[][], marker: string): Record<string, string>[] {
  const h = rows.findIndex((r) => r.some((c) => c.trim() === marker));
  if (h < 0) throw new Error(`Header "${marker}" not found – is this the right tab?`);
  const head = rows[h].map((c) => c.trim());
  return rows
    .slice(h + 1)
    .map((r, i) => ({ ...Object.fromEntries(head.map((k, j) => [k || `col${j}`, (r[j] ?? "").trim()])), _row: String(h + 2 + i) }))
    .filter((r) => Object.entries(r).some(([k, v]) => k !== "_row" && v));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "05-Aug-26" or "30-Sep-2026" (a time after it is ignored) → "2026-08-05". null if it is not a date. */
export function sheetDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})\b/.exec(s.trim());
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  if (!m || month < 0) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(year, month, Number(m[1])));
  return d.getUTCDate() === Number(m[1]) ? d.toISOString().slice(0, 10) : null; // 31-Feb rolls over
}

/** "2:50 pm" or "14:50" → "14:50". null if it is not a time. */
export function sheetTime(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const ampm = m[3]?.toLowerCase();
  if (ampm ? h < 1 || h > 12 : h > 23) return null;
  if (Number(m[2]) > 59) return null;
  if (ampm) h = (h % 12) + (ampm === "pm" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export const sheetNumber = (s: string): number | null => {
  const n = Number(s.replace(/,/g, ""));
  return s.trim() && Number.isFinite(n) ? n : null;
};

export type Sample = { lot: string; drum: string; testType: string; result: string };

/**
 * The sheet's own "Test Result" rule for one curing row: samples of this drum in this lot if there
 * are any, else every sample of the lot; retests replace first tests; any Fail = FAIL.
 * The dashboard keeps one result per curing row, so the samples collapse into it.
 * All samples "Incomplete" → null: we do not record a Pass nobody measured (the sheet shows Pass there).
 */
export function collapseSamples<T extends Sample>(all: T[], lot: string, drum: string): { used: T[]; result: "PASS" | "FAIL" | null } {
  const inLot = all.filter((s) => s.lot === lot);
  const ofDrum = inLot.filter((s) => s.drum === drum);
  const pool = ofDrum.length ? ofDrum : inLot;
  const retests = pool.filter((s) => s.testType.toLowerCase() === "retest");
  const used = retests.length ? retests : pool;
  const res = used.map((s) => s.result.toLowerCase());
  return { used, result: res.includes("fail") ? "FAIL" : res.includes("pass") ? "PASS" : null };
}

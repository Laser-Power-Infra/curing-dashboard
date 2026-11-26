/**
 * Sheet → dashboard sync (guide 4.3). Run it once for the history, then daily for new and changed rows.
 *
 * Runs hourly as the job /api/jobs/sync and by hand through scripts/import-sheet.ts:
 *   npm run db:import                      reads the Google Sheets directly (needs GOOGLE_TOKEN_JSON, see services/google-sheets.ts)
 *   npm run db:import -- <folder>          reads CSV downloads instead; a file is found by the tab name in its name
 *   add --dry-run to check without writing
 *
 * Tabs:  Curing Sheet:                 Product Master, Curing Recipe Master, Curing Log, Hot Set Test, Boiler Temp Log
 *        Sioplas Drum Stock & Curing:  Drum Register
 *
 * Safe to run again. New rows are added; a Curing Log row that changed in the sheet (end time, sent
 * date, remarks …) and its test result are updated. For imported rows the sheet wins over edits
 * made in the dashboard. Statuses, planned hours, test due and the Missing Drum Tracker are not
 * copied from the sheet – the rules engine works them out at the end.
 * Historic rows raise no alerts while Settings → alerts.enabledFrom is empty.
 * shortcut: a curing row is recognised by lot + drum + start time and a boiler row by all its cells,
 * so correcting those in the sheet adds a second row here; give the sheet a row ID column to fix that.
 *
 * The Boiler Temp Log goes row for row into its own table (boiler_temp_log), not into the per-shift
 * boiler readings: the sheet logs three water tanks several times a shift.
 * shortcut: Daily History is not imported – its sheet columns (pending / overdue counts) do not fit
 * the dashboard's daily_history table. Decide the mapping first.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { parseDateOnly, parseIstInput } from "@/lib/format";
import { drumSync, type JobResult } from "@/services/jobs";
import { runAll } from "@/services/rules/run";
import { readTab } from "@/services/google-sheets";
import { collapseSamples, parseCsv, sheetDate, sheetNumber, sheetTime, toRecords } from "@/services/sheet-import";

const BY = "import";
// Set at the start of each run by sheetSync.
let dryRun = false;
let folder: string | undefined;
let total = { rowsRead: 0, rowsChanged: 0 };

type Rec = Record<string, string>;
type Reject = { row: string; reason: string };

const CURING_SHEET = process.env.CURING_SHEET_ID ?? "1GgRE8r_r75vQt4ZZlFMlPCDkkVf1DJZrlfosT0Mc_bI";
const DRUM_SHEET = process.env.DRUM_SHEET_ID ?? "19cdxIdqaviuiCjaACIQSiawALz8HiyX_5I4vVXrH1Mo";

async function load(tab: string, marker: string): Promise<Rec[] | null> {
  if (!folder) return toRecords(await readTab(tab === "Drum Register" ? DRUM_SHEET : CURING_SHEET, tab), marker);
  const file = readdirSync(folder).find((f) => f.toLowerCase().endsWith(".csv") && f.toLowerCase().includes(tab.toLowerCase()));
  if (!file) return console.log(`– ${tab}: no CSV in the folder, skipped`), null;
  return toRecords(parseCsv(readFileSync(path.join(folder, file), "utf8").replace(/^﻿/, "")), marker);
}

// Dates, Decimals and plain values compared by value: only what really changed is written.
const val = (v: unknown) => (v == null ? null : v instanceof Date ? v.getTime() : typeof v === "object" ? Number(v) : v);
function changes<T extends object>(old: object, next: T): Partial<T> | null {
  const d = Object.entries(next).filter(([k, v]) => val((old as Record<string, unknown>)[k]) !== val(v));
  return d.length ? (Object.fromEntries(d) as Partial<T>) : null;
}

async function report(source: string, rowsRead: number, rowsImported: number, rejected: Reject[], note = "") {
  console.log(`✓ ${source}: read ${rowsRead}, imported ${rowsImported}, rejected ${rejected.length}${note && `, ${note}`}`);
  total = { rowsRead: total.rowsRead + rowsRead, rowsChanged: total.rowsChanged + rowsImported };
  rejected.slice(0, 15).forEach((r) => console.log(`    row ${r.row}: ${r.reason}`));
  if (rejected.length > 15) console.log(`    … ${rejected.length - 15} more in the import_batches table`);
  if (!dryRun)
    await prisma.importBatch.create({
      data: { source, finishedAt: new Date(), rowsRead, rowsImported, rowsRejected: rejected.length, report: rejected.slice(0, 500), importedBy: BY },
    });
}

const key = (s: string) => s.trim().toUpperCase();
const at = (date: string | null, time: string | null) => (date ? parseIstInput(`${date}T${time ?? "00:00"}`) : null);
// Dry run only: nothing is written, so later tabs look up what earlier tabs would have added here.
const sheetProducts = new Set<string>();
const sheetLots = new Set<string | null>();

async function products() {
  const rows = await load("Product Master", "Product");
  if (!rows) return;
  let n = 0;
  for (const r of rows) {
    sheetProducts.add(key(r["Product"]));
    const data = { sizeSqMm: sheetNumber(r["Size (sqmm)"] ?? ""), voltageKv: sheetNumber((r["Voltage"] ?? "").replace(/kv/i, "")) };
    if (!dryRun) await prisma.product.upsert({ where: { name: r["Product"] }, update: {}, create: { name: r["Product"], ...data, createdBy: BY } });
    n++;
  }
  await report("Curing Sheet › Product Master", rows.length, n, [], "existing products left as they are");
}

async function recipes() {
  const rows = await load("Curing Recipe Master", "Recipe ID");
  if (!rows) return;
  const productBy = new Map((await prisma.product.findMany()).map((p) => [key(p.name), p.id]));
  // The sheet's Recipe ID has no column here, so it leads the remarks and marks the row as imported.
  const have = new Set((await prisma.curingRecipe.findMany({ select: { remarks: true } })).map((r) => r.remarks?.split(" | ")[0]));
  const rejected: Reject[] = [];
  let n = 0;
  for (const r of rows) {
    const id = r["Recipe ID"];
    const productId = productBy.get(key(r["Product"] ?? "")) ?? (dryRun && sheetProducts.has(key(r["Product"] ?? "")) ? "dry-run" : undefined);
    const cure = sheetNumber(r["Approved Curing Hrs"] ?? "");
    const wait = sheetNumber(r["Wait Before Test (hrs)"] ?? "");
    const reject = (reason: string) => rejected.push({ row: r._row, reason: `${id}: ${reason}` });
    if (!id) { reject("Recipe ID is blank"); continue; }
    if (have.has(id)) continue;
    if (!productId) { reject(`Product "${r["Product"]}" is not in the Product Master`); continue; }
    if (!r["XLPE Compound"] || !r["Curing Type"]) { reject("Compound or curing type is blank"); continue; }
    if (cure == null || wait == null) { reject("Curing hours or wait hours is not a number"); continue; }
    const approved = (r["Status"] ?? "").toLowerCase() === "approved";
    const data = {
      compound: r["XLPE Compound"],
      productId,
      curingType: r["Curing Type"],
      approvedCuringHrs: cure,
      waitBeforeTestHrs: wait,
      inUse: (r["In Use?"] ?? "").toLowerCase() === "yes",
      status: approved ? ("APPROVED" as const) : ("DRAFT" as const),
      approvedBy: approved ? BY : null,
      approvedAt: approved ? at(sheetDate(r["Approved On"] ?? ""), null) : null,
      remarks: [id, r["MD Remarks / Note"]].filter(Boolean).join(" | "),
      createdBy: BY,
    };
    if (!dryRun) await prisma.curingRecipe.create({ data });
    n++;
  }
  await report("Curing Sheet › Curing Recipe Master", rows.length, n, rejected);
}

// The database hands JSON back with its keys in another order: compare by content, not by text.
const stable = (rows: unknown) => JSON.stringify((Array.isArray(rows) ? rows : []).map((r) => Object.entries(r as object).sort(([x], [y]) => (x < y ? -1 : 1))));

const logKey = (lot: string | null, drum: string, start: Date) => `${lot ?? ""}|${drum}|${start.getTime()}`;

async function curingLog() {
  const rows = await load("Curing Log", "Core Drum No");
  if (!rows) return;
  const productBy = new Map((await prisma.product.findMany()).map((p) => [key(p.name), p.id]));
  const have = new Map((await prisma.curingLog.findMany({ where: { source: "IMPORT" } })).map((l) => [logKey(l.lotNo, l.coreDrumNo, l.curingStartAt), l]));
  const seen = new Set<string>();
  const rejected: Reject[] = [];
  const fresh = [];
  let updated = 0;
  for (const r of rows) {
    const drum = r["Core Drum No"];
    const startDate = sheetDate(r["Curing Start Date"] ?? "");
    const startTime = sheetTime(r["Curing Start Time"] ?? "");
    const endDate = sheetDate(r["Curing End Date"] ?? "");
    const endTime = sheetTime(r["Curing End Time"] ?? "");
    const start = at(startDate, startTime);
    const end = at(endDate, endTime);
    const reject = (reason: string) => rejected.push({ row: r._row, reason: `lot ${r["Lot No"] || "?"} drum ${drum || "?"}: ${reason}` });
    if (!drum) { reject("Core Drum No is blank"); continue; }
    if (!start) { reject("Curing Start Date is blank or not a date (a row cannot be stored without it)"); continue; }
    if (r["Curing End Date"] && !end) { reject("Curing End Date is not a date"); continue; }
    const k = logKey(r["Lot No"] || null, drum, start);
    if (seen.has(k)) continue; // the same row twice in the sheet
    seen.add(k);
    sheetLots.add(r["Lot No"] || null);
    const visual = (r["Visual Check"] ?? "").toLowerCase().replace(/\s/g, "");
    const notes = [r["Remarks"], !startTime && "start time missing in the sheet – 00:00 used", end && !endTime && "end time missing in the sheet – 00:00 used", end && end < start && "end is before start in the sheet – check the times"];
    const data = {
      lotNo: r["Lot No"] || null,
      coreProductionDate: parseDateOnly(sheetDate(r["Core Production Date"] ?? "")),
      productId: productBy.get(key(r["Product"] ?? "")) ?? null,
      productName: r["Product"] || null,
      coreDrumNo: drum,
      lengthM: sheetNumber(r["Length (m)"] ?? ""),
      xlpeCompound: r["XLPE Compound"] || null,
      chamberTankText: r["Chamber / Tank"] || null,
      curingStartAt: start,
      curingEndAt: end,
      visualCheck: visual === "ok" ? ("OK" as const) : visual === "notok" ? ("NOT_OK" as const) : null,
      sentDate: at(sheetDate(r["Sent Date"] ?? ""), null),
      remarks: notes.filter(Boolean).join(" | ") || null,
      mdRemarks: r["MD Remarks"] || null,
    };
    const old = have.get(k);
    if (!old) { fresh.push({ ...data, source: "IMPORT" as const, createdBy: BY }); continue; }
    const diff = changes(old, data);
    if (!diff) continue;
    if (!dryRun) await prisma.curingLog.update({ where: { id: old.id }, data: { ...diff, updatedBy: BY } });
    updated++;
  }
  if (!dryRun && fresh.length) await prisma.curingLog.createMany({ data: fresh });
  await report("Curing Sheet › Curing Log", rows.length, fresh.length, rejected, `${updated} existing row(s) updated`);
}

async function hotSetTests() {
  const rows = await load("Hot Set Test", "Lot No");
  if (!rows) return;
  const dateCol = Object.keys(rows[0] ?? {})[0]; // the date column has a blank header
  const samples = rows.map((r) => ({ r, lot: r["Lot No"], drum: r["Core Drum No"], testType: r["Test Type"] ?? "", result: r["Result (auto)"] ?? "" }));
  const logs = await prisma.curingLog.findMany({ where: { source: "IMPORT", lotNo: { not: null } }, include: { hotSetTests: { select: { id: true, source: true, result: true, readings: true } } } });
  const lots = new Set([...logs.map((l) => l.lotNo), ...(dryRun ? sheetLots : [])]);
  const rejected: Reject[] = samples.filter((s) => !lots.has(s.lot)).map((s) => ({ row: s.r._row, reason: `lot ${s.lot || "?"} is not in the imported Curing Log` }));
  const num = (v: string | undefined) => sheetNumber(v ?? "");
  const max = (vals: (number | null)[]) => { const n = vals.filter((v): v is number => v != null && Math.abs(v) < 10000); return n.length ? Math.max(...n) : null; };
  let n = 0;
  let unmeasured = 0;
  let updated = 0;
  for (const log of logs) {
    // A result typed into the dashboard is never replaced by the sheet.
    if (log.hotSetTests.some((t) => t.source !== "IMPORT")) continue;
    const old = log.hotSetTests[0];
    const { used, result } = collapseSamples(samples, log.lotNo!, log.coreDrumNo);
    if (!used.length) continue;
    if (!result) { unmeasured += old ? 0 : 1; continue; }
    // Unchanged samples (a retest or a corrected reading changes them) → nothing to do.
    if (old && old.result === result && stable(old.readings) === stable(used.map((s) => s.r))) continue;
    const dates = used.map((s) => sheetDate(s.r[dateCol] ?? "")).filter((d): d is string => !!d).sort();
    const lotLevel = used.some((s) => s.drum !== log.coreDrumNo);
    const data = {
      curingLogId: log.id,
      drumId: log.drumId,
      lotNo: log.lotNo,
      sampleEnd: [...new Set(used.map((s) => s.r["Sample End"]).filter(Boolean))].join(" + ") || null,
      testType: used[0].testType || null,
      // Every sample row of the sheet, as it was: the one result above is worked out from these.
      readings: used.map((s) => s.r),
      hotSetPct: max(used.map((s) => num(s.r["Hot Set % (auto) – max 175"]))),
      permanentSetPct: max(used.map((s) => num(s.r["Permanent Set % (auto) – max 15"]))),
      result,
      // The sheet has the test date only: noon IST is used.
      testedAt: (dates.length ? at(dates[dates.length - 1], "12:00") : null) ?? log.curingEndAt ?? log.curingStartAt,
      testedBy: [...new Set(used.map((s) => s.r["Tested By"]).filter(Boolean))].join(", ") || null,
      remarks: `Imported: ${used.length} sample(s) from the sheet${lotLevel ? ", lot-level (no sample for this drum)" : ""}`,
      source: "IMPORT" as const,
      createdBy: BY,
    };
    if (old) {
      if (!dryRun) await prisma.hotSetTest.update({ where: { id: old.id }, data: { ...data, createdBy: undefined, updatedBy: BY } });
      updated++;
      continue;
    }
    if (!dryRun) await prisma.hotSetTest.create({ data });
    n++;
  }
  await report("Curing Sheet › Hot Set Test", rows.length, n, rejected, dryRun ? "dry run: new results are built only when the Curing Log is written" : `one result per curing row; ${updated} result(s) updated; ${unmeasured} curing row(s) had only incomplete samples and got no result`);
}

async function boilerTempLog() {
  const rows = await load("Boiler Temp Log", "Operator");
  if (!rows) return;
  const rejected: Reject[] = [];
  const data = [];
  for (const r of rows) {
    const date = parseDateOnly(sheetDate(r["Date"] ?? ""));
    if (!date) { rejected.push({ row: r._row, reason: `Date "${r["Date"]}" is not a date` }); continue; }
    const cells = Object.entries(r).filter(([k]) => k !== "_row").map(([, v]) => v);
    data.push({
      date,
      time: sheetTime(r["Time"] ?? ""),
      shift: r["Reading (Morning / Afternoon / Night)"] || null,
      tank1C: sheetNumber(r["Water Tank 1 Temp °C"] ?? ""),
      tank2C: sheetNumber(r["Water Tank 2 Temp °C"] ?? ""),
      tank3C: sheetNumber(r["Water Tank 3 Temp °C"] ?? ""),
      fuel: r["Boiler Running On (Diesel / Wood)"] || null,
      operator: r["Operator"] || null,
      remarks: r["Remarks"] || null,
      rowKey: cells.join("|"),
    });
  }
  // Two identical rows in the sheet are one reading typed twice: rowKey keeps one.
  const n = dryRun ? data.length : (await prisma.boilerTempLog.createMany({ data, skipDuplicates: true })).count;
  await report("Curing Sheet › Boiler Temp Log", rows.length, n, rejected, "rows already there are skipped");
}

async function drums() {
  // The register has hundreds of pre-formatted rows holding only an unticked checkbox.
  const rows = (await load("Drum Register", "Grid entry ID"))?.filter((r) => r["Grid entry ID"] || r["Drum no"]);
  if (!rows) return;
  const body = {
    rows: rows.map((r) => ({
      gridEntryId: r["Grid entry ID"],
      line: r["Line"],
      unloadDate: sheetDate(r["Made on"] ?? "") ?? r["Made on"],
      prodOrders: r["Prod Order"],
      mcNo: r["MC No"],
      party: r["Party"],
      coreItem: r["Core / conductor"],
      drumNo: r["Drum no"],
      drumSize: r["Drum size"],
      lengthM: r["Length (m)"],
      enteredBy: r["Entered by"],
      stockStatus: r["Stock status"],
    })),
  };
  if (dryRun) return void (await report("Drum Register", rows.length, 0, [], "dry run: rows are checked only when written"));
  const started = new Date();
  // The hourly drum sync already validates, flags and de-duplicates these rows: same code, one-time source.
  const d = (await drumSync(body)).details as { inserted: number; outOfScope: number; rejected: { row: number; gridEntryId: string; reason: string }[] };
  await prisma.drum.updateMany({ where: { createdBy: "job:W1", createdAt: { gte: started } }, data: { source: "IMPORT", createdBy: BY } });
  const rejected = d.rejected.map((x) => ({ row: rows[x.row - 1]?._row ?? String(x.row), reason: `Grid ID ${x.gridEntryId || "?"}: ${x.reason}` }));
  await report("Drum Register", rows.length, d.inserted, rejected, `${d.outOfScope} on lines that are not in scope`);
}

export async function sheetSync(opts: { folder?: string; dryRun?: boolean } = {}): Promise<JobResult> {
  dryRun = !!opts.dryRun;
  folder = opts.folder;
  total = { rowsRead: 0, rowsChanged: 0 };
  sheetProducts.clear();
  sheetLots.clear();
  if (!(await prisma.line.count())) throw new Error("No lines in the database. Run  npm run db:seed  first.");
  console.log(dryRun ? "DRY RUN – nothing is written\n" : "");
  await products();
  await recipes();
  await drums();
  await curingLog();
  await hotSetTests();
  await boilerTempLog();
  if (dryRun) return { ...total, alerts: 0 };

  console.log("\nRunning the rules over the history (matching, statuses, tracker)…");
  const r = await runAll(BY);
  console.log(`  ${r.rowsChanged} rows updated, ${r.alerts} alerts`);
  const count = async (by: "lotStatus" | "status") =>
    by === "lotStatus"
      ? (await prisma.curingLog.groupBy({ by: ["lotStatus"], _count: true })).map((g) => `${g.lotStatus ?? "none"} ${g._count}`)
      : (await prisma.drum.groupBy({ by: ["status"], _count: true })).map((g) => `${g.status} ${g._count}`);
  console.log(`\nReconcile against the Curing Sheet › Summary tab (guide 4.3 step 5):`);
  console.log(`  Curing rows by status: ${(await count("lotStatus")).join(", ")}`);
  console.log(`  Drums by status:       ${(await count("status")).join(", ")}`);
  return { rowsRead: total.rowsRead, rowsChanged: total.rowsChanged + r.rowsChanged, alerts: r.alerts };
}

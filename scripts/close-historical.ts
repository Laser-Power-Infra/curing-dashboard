/**
 * One-time clean-up of the imported history (MD's mails, Nov 2026): old lots that still look open.
 *
 *   npx tsx --env-file=.env scripts/close-historical.ts [--before=YYYY-MM-DD] [--unlinked] [--apply]
 *
 * DRY RUN unless --apply: it only reads, and prints every row it would change.
 * --before    cut-off, IST day (default for a dry run: 2026-10-01, the June–Sept lots). Required with --apply.
 * --unlinked  also take curing rows not linked to a drum (most of the imported history; the lists hide them already).
 *
 * What it closes – never a row that is sent, on a requisition, or of lot 446:
 *   PASSED    passed, every test before the cut-off                → "historical – cleaned" (already sent to Polypark)
 *   FAILED    lots 208, 209, 211, 336, 370, cured before cut-off   → "historical – closed"
 *   UNTESTED  curing ended before the cut-off, no test             → "historical – closed"
 *
 * How: sentDate = the cut-off, and the note is added to the remarks. Nothing is deleted.
 * A sent date is the only "closed" the rules engine knows (deriveDrumStatus: sent date → SENT, before the
 * test result is looked at), so the next rules run shows these rows as Sent, raises no alert on them and
 * does not put them back. The test result itself is not touched. The sheet sync keeps the sent date and
 * remarks of a row carrying the note (services/sheet-sync.ts), so the hourly sync does not undo it either.
 * Statuses on screen change at the next rules run (hourly), not at once.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { logScope } from "@/lib/scope";
import { fmtDate, fmtDateTime, parseIstInput } from "@/lib/format";
import { HISTORICAL } from "@/services/sheet-import";

const BY = "script:close-historical";
const FAILED_LOTS = ["208", "209", "211", "336", "370"];
const NEVER = "446"; // the one real, current fail
const DRY_RUN_BEFORE = "2026-10-01";

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !["--apply", "--unlinked"].includes(a) && !/^--before=\d{4}-\d{2}-\d{2}$/.test(a));
  if (unknown.length) throw new Error(`Not understood: ${unknown.join(" ")}`);
  const apply = args.includes("--apply");
  const before = args.find((a) => a.startsWith("--before="))?.slice(9);
  if (apply && !before) throw new Error("--apply needs --before=YYYY-MM-DD");
  const cutoff = parseIstInput(`${before ?? DRY_RUN_BEFORE}T00:00`);
  if (!cutoff || cutoff > new Date()) throw new Error("--before must be a date that is not in the future");

  const scope = args.includes("--unlinked") ? { OR: [logScope(), { drumId: null }] } : logScope();
  const open = { sentDate: null, requisitionId: null };
  const include = { drum: { include: { line: true, curingLogs: { select: { cycleNo: true } } } }, hotSetTests: { select: { testedAt: true }, orderBy: { testedAt: "desc" as const }, take: 1 } };
  const orderBy = { curingStartAt: "asc" as const };
  const [passed, failed, untested] = await Promise.all([
    prisma.curingLog.findMany({ where: { ...scope, ...open, testResult: "PASS", hotSetTests: { some: {}, none: { testedAt: { gte: cutoff } } } }, include, orderBy }),
    prisma.curingLog.findMany({ where: { ...open, testResult: "FAIL", lotNo: { in: FAILED_LOTS }, curingStartAt: { lt: cutoff } }, include, orderBy }),
    prisma.curingLog.findMany({ where: { ...scope, ...open, testResult: null, curingEndAt: { lt: cutoff }, hotSetTests: { none: {} } }, include, orderBy }),
  ]);

  const rows = [
    ...passed.map((r) => ({ r, kind: "PASSED  ", note: `${HISTORICAL} cleaned` })),
    ...failed.map((r) => ({ r, kind: "FAILED  ", note: `${HISTORICAL} closed` })),
    ...untested.map((r) => ({ r, kind: "UNTESTED", note: `${HISTORICAL} closed` })),
  ]
    // As the lists do: an older cycle of a re-cured drum is not the drum's state. Lot 446 is never taken.
    .filter(({ r }) => r.lotNo !== NEVER && !r.drum?.curingLogs.some((c) => c.cycleNo > r.cycleNo))
    .map((x) => ({ ...x, remarks: [x.r.remarks, x.note].filter(Boolean).join(" | ") }));
  if (rows.some(({ r }) => r.lotNo === NEVER || r.sentDate || r.requisitionId)) throw new Error("Selection is wrong – stopped before anything was written.");

  console.log(`${apply ? "APPLY" : "DRY RUN – nothing is written"} · cut-off ${fmtDate(cutoff)} (IST) · ${args.includes("--unlinked") ? "in-scope drums and rows not linked to a drum" : "in-scope drums only"}\n`);
  for (const { r, kind, remarks } of rows)
    console.log(
      `${kind} lot ${r.lotNo ?? "–"} · drum ${r.coreDrumNo} · ${r.drum?.line.name ?? "not linked"} · cured ${fmtDateTime(r.curingStartAt)} → ${fmtDateTime(r.curingEndAt)} · tested ${fmtDate(r.hotSetTests[0]?.testedAt)}` +
        ` · set sentDate ${fmtDate(cutoff)}, remarks "${remarks}"`,
    );
  const km = (kind: string) => rows.filter((x) => x.kind.trim() === kind).reduce((s, { r }) => s + Number(r.lengthM ?? r.drum?.lengthM ?? 0), 0) / 1000;
  const n = (kind: string) => rows.filter((x) => x.kind.trim() === kind).length;
  console.log(`\nTotals: ${rows.length} curing rows – passed ${n("PASSED")} (${km("PASSED").toFixed(1)} km), failed ${n("FAILED")} (${km("FAILED").toFixed(1)} km), untested ${n("UNTESTED")} (${km("UNTESTED").toFixed(1)} km)`);

  if (!apply) return console.log("Dry run: nothing was written. Add --apply (with --before) to make these changes.");

  // The only writes of this script. All rows or none.
  await prisma.$transaction(
    async (tx) => {
      for (const { r, remarks } of rows) {
        const done = await tx.curingLog.updateMany({ where: { id: r.id, ...open }, data: { sentDate: cutoff, remarks, updatedBy: BY } });
        if (done.count !== 1) throw new Error(`Lot ${r.lotNo} drum ${r.coreDrumNo} changed while this ran. Nothing was written – run it again.`);
        await audit("curing_logs", r.id, "CLOSE", { sentDate: { old: null, new: cutoff }, remarks: { old: r.remarks, new: remarks } }, BY, "JOB", tx);
      }
    },
    { timeout: 300_000, maxWait: 20_000 },
  );
  console.log(`Done: ${rows.length} curing rows closed. Statuses change at the next rules run.`);
}

main()
  .catch((e) => { console.error(`\nStopped: ${e instanceof Error ? e.message : "The database connection dropped. Run it again: rows already closed are skipped."}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

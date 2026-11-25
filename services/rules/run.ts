// Database side of the rules engine: load, decide with the pure functions, write only what changed.
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { fmtDateTime, fmtDuration, fmtM, hoursBetween, istDayStart } from "@/lib/format";
import { escalate, type Condition } from "@/services/alerts/escalate";
import type { AlertTrigger } from "@/generated/prisma/enums";
import { computeCuringFields, deriveDrumStatus, looksLikeCuringItem, matchDrums } from "./index";
import { trackerAuto } from "./decide";

export type RunResult = { rowsRead: number; rowsChanged: number; alerts: number };

const TRIGGERS: AlertTrigger[] = ["DRUM_NOT_IN_CURING", "UNDER_CURED", "NO_RECIPE", "TEST_OVERDUE", "TEST_FAILED", "PASSED_NO_REQUISITION"];
const AUTO_FLAGS = ["NOT_CURING_ITEM", "DUPLICATE_SAME_DAY"];

const recipeKey = (compound: string | null, productId: string | null) => (compound?.trim() && productId ? `${compound.trim().toLowerCase()}|${productId}` : null);
// Decimal(6,2) columns: a mistyped year must not make the whole run fail.
const clamp = (n: number | null) => (n == null ? null : Math.max(-9999.99, Math.min(9999.99, n)));

// Dates, Decimals and plain values compared by value.
const val = (v: unknown) => (v == null ? null : v instanceof Date ? v.getTime() : typeof v === "object" ? Number(v) : v);
function changed<T extends object>(row: object, next: T): Partial<T> | null {
  const old = row as Record<string, unknown>;
  const d = Object.entries(next).filter(([k, v]) => val(old[k]) !== val(v));
  return d.length ? (Object.fromEntries(d) as Partial<T>) : null;
}
async function each<T>(items: T[], fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += 10) await Promise.all(items.slice(i, i + 10).map(fn));
}

export async function findRecipe(compound: string, productId: string) {
  const r = await prisma.curingRecipe.findFirst({
    where: { compound: { equals: compound.trim(), mode: "insensitive" }, productId, inUse: true, status: "APPROVED" },
    orderBy: [{ approvedAt: "desc" }, { id: "asc" }],
  });
  return r && { id: r.id, curingType: r.curingType, approvedCuringHrs: Number(r.approvedCuringHrs), waitBeforeTestHrs: Number(r.waitBeforeTestHrs) };
}

export async function runAll(by: string): Promise<RunResult> {
  const now = new Date();
  const settings = await getSettings();
  // shortcut: loads every in-scope drum and every curing row on each run; add a date window when these pass ~10,000 rows.
  const [drums, logs, recipes, products] = await Promise.all([
    prisma.drum.findMany({ where: { line: { inScope: true } }, include: { line: { select: { name: true } }, tracker: true } }),
    prisma.curingLog.findMany({
      include: {
        hotSetTests: { select: { id: true, result: true, testedAt: true, createdAt: true } },
        requisition: { select: { status: true } },
      },
    }),
    prisma.curingRecipe.findMany({ orderBy: [{ approvedAt: "desc" }, { id: "asc" }] }),
    prisma.product.findMany({ select: { id: true, name: true, isCuringItem: true } }),
  ]);
  let rowsChanged = 0;

  // --- Curing item or not: the Product Master wins, else the name decides ------------------
  const productById = new Map(products.map((p) => [p.id, p]));
  const productByName = new Map(products.map((p) => [p.name.trim().toUpperCase(), p]));
  const curingIds = new Set(
    drums
      .filter((d) => {
        const p = (d.productId && productById.get(d.productId)) || productByName.get(d.coreItem.trim().toUpperCase());
        return p ? p.isCuringItem : d.isCuringItem && looksLikeCuringItem(d.coreItem);
      })
      .map((d) => d.id),
  );
  const drumById = new Map(drums.map((d) => [d.id, d]));
  const curing = drums.filter((d) => curingIds.has(d.id));

  // --- Rule 3: match ---------------------------------------------------------------------
  const outcomes = matchDrums(curing, logs, now, settings.curingStartLimitHours);
  const logById = new Map(logs.map((l) => [l.id, l]));
  const newLinks: { id: string; drumId: string }[] = [];
  for (const d of curing) {
    const o = outcomes.get(d.id)!;
    const log = "logId" in o ? logById.get(o.logId) : undefined;
    if (log && !log.drumId) {
      log.drumId = d.id;
      newLinks.push({ id: log.id, drumId: d.id });
    }
  }
  // `drumId: null` in the filter: a row a person linked meanwhile is left alone.
  await each(newLinks, (l) =>
    prisma.curingLog.updateMany({ where: { id: l.id, drumId: null }, data: { drumId: l.drumId, matchMethod: "AUTO", matchedAt: now, updatedBy: by } }),
  );
  rowsChanged += newLinks.length;

  // --- Rules 4–6: computed columns of every curing row -------------------------------------
  const latestOf = new Map<string, (typeof logs)[number]>(); // drum id → latest cycle
  for (const l of logs) {
    const cur = l.drumId ? latestOf.get(l.drumId) : undefined;
    if (l.drumId && (!cur || l.cycleNo > cur.cycleNo || (l.cycleNo === cur.cycleNo && l.curingStartAt > cur.curingStartAt))) latestOf.set(l.drumId, l);
  }
  const currentRecipe = new Map<string, (typeof recipes)[number]>();
  for (const r of recipes) {
    const k = recipeKey(r.compound, r.productId);
    if (k && r.inUse && r.status === "APPROVED" && !currentRecipe.has(k)) currentRecipe.set(k, r);
  }
  const recipeById = new Map(recipes.map((r) => [r.id, r]));

  const from = settings.alertsEnabledFrom;
  const alertable = (at: Date | null | undefined) => !!from && !!at && at >= from;
  const conditions: Condition[] = [];
  const logWrites: { id: string; data: object }[] = [];
  const computed = new Map<string, { testDueAt: Date | null; testResult: "PASS" | "FAIL" | null }>();

  for (const l of logs) {
    const drum = l.drumId ? drumById.get(l.drumId) : undefined;
    const k = recipeKey(l.xlpeCompound, l.productId ?? drum?.productId ?? null);
    // A recipe retired later still applies to the rows that were cured with it.
    const kept = l.recipeId ? recipeById.get(l.recipeId) : undefined;
    const recipe = (k && (currentRecipe.get(k) ?? (kept && recipeKey(kept.compound, kept.productId) === k ? kept : null))) || null;
    const f = computeCuringFields(
      l.curingStartAt,
      l.curingEndAt,
      recipe && { approvedCuringHrs: Number(recipe.approvedCuringHrs), waitBeforeTestHrs: Number(recipe.waitBeforeTestHrs) },
    );
    // Rule 6: the result is what the lab entered on the latest test, never recalculated.
    const test = [...l.hotSetTests].sort((a, b) => b.testedAt.getTime() - a.testedAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0];
    const testResult = test?.result ?? null;
    const lotStatus = deriveDrumStatus(
      {
        isCuringItem: true,
        match: "CURED",
        latest: {
          curingEndAt: l.curingEndAt,
          testDueAt: f.testDueAt,
          testResult,
          onOpenRequisition: !!l.requisition && l.requisition.status !== "CANCELLED",
          sentDate: l.sentDate,
        },
      },
      now,
      settings.testOverdueGraceHours,
    );
    computed.set(l.id, { testDueAt: f.testDueAt, testResult });
    const data = changed(l, {
      recipeId: recipe?.id ?? null,
      ...f,
      actualCuringHrs: clamp(f.actualCuringHrs),
      hoursDeviation: clamp(f.hoursDeviation),
      testResult,
      lotStatus,
    });
    if (data) logWrites.push({ id: l.id, data });

    // Alerts only for the latest cycle of an in-scope curing drum (or a row not linked yet) that is not sent.
    if (l.drumId ? !curingIds.has(l.drumId) || latestOf.get(l.drumId) !== l : false) continue;
    if (lotStatus === "SENT" || !alertable(drum ? (drum.unloadedAt ?? istDayStart(drum.unloadDate)) : l.curingStartAt)) continue;
    const name = `${l.lotNo ? `Lot ${l.lotNo} · ` : ""}Drum ${l.coreDrumNo}`;
    const base = { objectType: "CURING_LOG" as const, objectId: l.id, ref: name };
    const anchors = { FROM_UNLOAD: drum?.unloadedAt, FROM_TEST_DUE: f.testDueAt };
    if (f.timeCheck === "NO_RECIPE")
      conditions.push({
        ...base,
        trigger: "NO_RECIPE",
        anchors: { ...anchors, FROM_EVENT: l.createdAt },
        text: `${name} · ${l.productName ?? "product not set"} · compound ${l.xlpeCompound ?? "not set"}`,
      });
    // Open until the lot is re-cured, corrected or the lab has given a result.
    if (f.timeCheck === "UNDER_CURED" && !testResult)
      conditions.push({
        ...base,
        trigger: "UNDER_CURED",
        anchors: { ...anchors, FROM_EVENT: l.curingEndAt },
        text: `${name} · cured ${fmtDuration(f.actualCuringHrs)}, approved ${fmtDuration(f.plannedCuringHrs)}`,
      });
    if (lotStatus === "TEST_OVERDUE" && f.testDueAt)
      conditions.push({
        ...base,
        trigger: "TEST_OVERDUE",
        anchors: { ...anchors, FROM_EVENT: f.testDueAt },
        text: `${name} · test due ${fmtDateTime(f.testDueAt)} (${fmtDuration(hoursBetween(f.testDueAt, now))} ago)`,
      });
    if (lotStatus === "FAILED" && test)
      conditions.push({
        trigger: "TEST_FAILED",
        objectType: "HOT_SET_TEST",
        objectId: test.id,
        ref: name,
        anchors: { ...anchors, FROM_EVENT: test.createdAt },
        text: `${name} · ${fmtM(l.lengthM)} · tested ${fmtDateTime(test.testedAt)}`,
      });
    if (lotStatus === "PASSED" && test)
      conditions.push({
        ...base,
        trigger: "PASSED_NO_REQUISITION",
        anchors: { ...anchors, FROM_EVENT: test.createdAt },
        text: `${name} · ${fmtM(l.lengthM)}`,
        lengthM: Number(l.lengthM ?? 0),
      });
  }
  await each(logWrites, (w) => prisma.curingLog.update({ where: { id: w.id }, data: w.data }));
  rowsChanged += logWrites.length;

  // --- Guide 5.9: drum status, flags, tracker ----------------------------------------------
  await each(drums, async (d) => {
    const isCuringItem = curingIds.has(d.id);
    const o = isCuringItem ? outcomes.get(d.id)! : null;
    const l = latestOf.get(d.id);
    const c = l && computed.get(l.id)!;
    const status = deriveDrumStatus(
      {
        isCuringItem,
        match: o?.kind ?? "PENDING",
        latest: l && c
          ? {
              curingEndAt: l.curingEndAt,
              testDueAt: c.testDueAt,
              testResult: c.testResult,
              onOpenRequisition: !!l.requisition && l.requisition.status !== "CANCELLED",
              sentDate: l.sentDate,
            }
          : null,
      },
      now,
      settings.testOverdueGraceHours,
    );
    const dataFlags = [
      ...d.dataFlags.filter((f) => !AUTO_FLAGS.includes(f)),
      ...(isCuringItem ? [] : ["NOT_CURING_ITEM"]),
      ...(o?.kind === "DATA_ERROR" ? ["DUPLICATE_SAME_DAY"] : []),
    ];
    if (isCuringItem !== d.isCuringItem || status !== d.status || dataFlags.join() !== d.dataFlags.join()) {
      await prisma.drum.update({ where: { id: d.id }, data: { isCuringItem, status, dataFlags, updatedBy: by } });
      await audit("drums", d.id, "UPDATE", { status: { old: d.status, new: status } }, by, "JOB");
      rowsChanged++;
    }

    // Rules 2 and 10: tracker row. Only the AUTO columns are ever written here.
    const t = d.tracker;
    const first = o && "logId" in o ? logById.get(o.logId) : undefined;
    const want = trackerAuto(t && { ...t, hoursLate: t.hoursLate == null ? null : Number(t.hoursLate) }, o, first?.curingStartAt ?? null, now);
    const data = want && (t ? changed(t, want) : want);
    if (want && data) {
      const row = await prisma.missingDrumTracker.upsert({ where: { drumId: d.id }, create: { drumId: d.id, ...want }, update: data });
      await audit("missing_drum_tracker", row.id, t ? "UPDATE" : "CREATE", t ? { status: { old: t.status, new: want.status } } : null, by, "JOB");
      rowsChanged++;
    }

    // Rule 1 alert: only drums with a known unload time can be Missing.
    if (o?.kind === "MISSING" && d.unloadedAt && alertable(d.unloadedAt))
      conditions.push({
        trigger: "DRUM_NOT_IN_CURING",
        objectType: "DRUM",
        objectId: d.id,
        ref: `Drum ${d.drumNo}`,
        anchors: { FROM_UNLOAD: d.unloadedAt },
        text: `${d.line.name} · Drum ${d.drumNo} · ${fmtM(d.lengthM)} · unloaded ${fmtDateTime(d.unloadedAt)} (${fmtDuration(o.hoursSinceUnload)})`,
      });
  });

  // --- Escalations and messages ------------------------------------------------------------
  const { alerts, claimed } = await escalate(TRIGGERS, conditions, now, settings);
  for (const e of claimed.filter((c) => c.trigger === "DRUM_NOT_IN_CURING"))
    await prisma.missingDrumTracker.updateMany({
      where: { drumId: e.objectId, escalationLevel: { lt: e.level } },
      data: { escalationLevel: e.level, lastAlertAt: now },
    });

  return { rowsRead: drums.length + logs.length, rowsChanged, alerts };
}

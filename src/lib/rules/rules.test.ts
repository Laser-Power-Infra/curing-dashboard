// Named after the acceptance tests in guide Section 13.
import { describe, expect, test } from "vitest";
import { compliance, computeCuringFields, deriveDrumStatus, looksLikeCuringItem, matchDrums, passRate, shiftOf, type MatchDrum, type MatchLog } from "./index";
import { dueLevels, trackerAuto, type LevelRule } from "./decide";
import { renderAlert } from "../alerts/templates";

const ist = (s: string) => new Date(`${s}:00+05:30`); // "2026-11-24T08:00"
const drum = (id: string, drumNo: string, at: string | null, day = at!.slice(0, 10)): MatchDrum => ({
  id,
  drumNo,
  unloadDate: new Date(`${day}T00:00:00Z`),
  unloadedAt: at ? ist(at) : null,
});
const log = (id: string, coreDrumNo: string, start: string, drumId: string | null = null): MatchLog => ({ id, coreDrumNo, curingStartAt: ist(start), drumId });
const LIMIT = 6;
const GRACE = 2;

// The MD matrix for "Drum not in curing" (seed.ts): 6 h, 8 h, 12 h from unload.
const drumRules: LevelRule[] = [
  { level: 1, anchor: "FROM_UNLOAD", delayMinutes: 360 },
  { level: 2, anchor: "FROM_UNLOAD", delayMinutes: 480 },
  { level: 3, anchor: "FROM_UNLOAD", delayMinutes: 720 },
];

describe("acceptance 1 – drum with no curing row", () => {
  const d = drum("d1", "915", "2026-11-24T08:00");
  test("pending up to 6 h, Missing after", () => {
    expect(matchDrums([d], [], ist("2026-11-24T14:00"), LIMIT).get("d1")).toEqual({ kind: "PENDING" });
    expect(matchDrums([d], [], ist("2026-11-24T14:01"), LIMIT).get("d1")?.kind).toBe("MISSING");
    expect(deriveDrumStatus({ isCuringItem: true, match: "MISSING", latest: null }, ist("2026-11-24T14:01"), GRACE)).toBe("MISSING");
    expect(deriveDrumStatus({ isCuringItem: true, match: "PENDING", latest: null }, ist("2026-11-24T10:00"), GRACE)).toBe("MADE");
  });
  test("only level 1 is due at 6 h", () => {
    const anchors = { FROM_UNLOAD: d.unloadedAt };
    expect(dueLevels(drumRules, anchors, new Set(), ist("2026-11-24T13:59"))).toEqual([]);
    expect(dueLevels(drumRules, anchors, new Set(), ist("2026-11-24T14:05")).map((l) => l.level)).toEqual([1]);
  });
  test("Missing opens a tracker row", () => {
    expect(trackerAuto(null, { kind: "MISSING", hoursSinceUnload: 6.1 }, null, ist("2026-11-24T14:05"))).toMatchObject({ status: "MISSING", closedAt: null });
  });
});

test("acceptance 2 – still missing at 8 h and 12 h: the next level only", () => {
  const anchors = { FROM_UNLOAD: ist("2026-11-24T08:00") };
  expect(dueLevels(drumRules, anchors, new Set([1]), ist("2026-11-24T16:05")).map((l) => l.level)).toEqual([2]);
  expect(dueLevels(drumRules, anchors, new Set([1, 2]), ist("2026-11-24T20:05")).map((l) => l.level)).toEqual([3]);
});

test("acceptance 3 – curing row added late: Late with hours late, tracker row closes", () => {
  const d = drum("d1", "915", "2026-11-24T08:00");
  const now = ist("2026-11-24T18:00");
  const o = matchDrums([d], [log("c1", " 915 ", "2026-11-24T16:30")], now, LIMIT).get("d1")!;
  expect(o).toEqual({ kind: "LATE", logId: "c1", hoursLate: 2.5 });
  const open = { status: "MISSING" as const, curingLogId: null, curingStartAt: null, hoursLate: null, closedAt: null };
  expect(trackerAuto(open, o, ist("2026-11-24T16:30"), now)).toEqual({ status: "LATE", curingLogId: "c1", curingStartAt: ist("2026-11-24T16:30"), hoursLate: 2.5, closedAt: now });
  // on time → Cured, and no tracker row is made for a drum that was never on the tracker
  const onTime = matchDrums([d], [log("c1", "915", "2026-11-24T14:00")], now, LIMIT).get("d1")!;
  expect(onTime).toEqual({ kind: "CURED", logId: "c1" });
  expect(trackerAuto(null, onTime, ist("2026-11-24T14:00"), now)).toBeNull();
});

describe("acceptance 4 – re-used drum number", () => {
  const now = ist("2026-11-25T12:00");
  test("does not match a curing row older than the unload", () => {
    const o = matchDrums([drum("d2", "915", "2026-11-24T08:00")], [log("old", "915", "2026-11-10T09:00")], now, LIMIT);
    expect(o.get("d2")?.kind).toBe("MISSING");
  });
  test("the earlier drum stays Missing; it never takes the later drum's row", () => {
    const drums = [drum("d1", "915", "2026-11-20T08:00"), drum("d2", "915", "2026-11-24T08:00")];
    const o = matchDrums(drums, [log("c2", "915", "2026-11-24T10:00")], now, LIMIT);
    expect(o.get("d1")?.kind).toBe("MISSING");
    expect(o.get("d2")).toEqual({ kind: "CURED", logId: "c2" });
  });
  test("a curing row is used once, and a row a person linked is never offered to another drum", () => {
    const drums = [drum("d1", "915", "2026-11-24T08:00"), drum("d2", "915", "2026-11-24T08:00")];
    const one = matchDrums(drums, [log("c1", "915", "2026-11-24T09:00")], now, LIMIT);
    expect([one.get("d1")?.kind, one.get("d2")?.kind].sort()).toEqual(["CURED", "MISSING"]);
    // c1 sits in d1's window but belongs to d9 by hand
    const o = matchDrums([drum("d1", "915", "2026-11-24T08:00")], [log("c1", "915", "2026-11-24T09:00", "d9")], now, LIMIT);
    expect(o.get("d1")?.kind).toBe("MISSING");
    // and a manual link is respected even when the times do not fit the rule
    const manual = matchDrums([drum("d1", "915", "2026-11-24T08:00")], [log("c0", "777", "2026-11-24T07:00", "d1")], now, LIMIT);
    expect(manual.get("d1")).toEqual({ kind: "CURED", logId: "c0" });
  });
});

describe("acceptance 5 – same drum no twice on the same day (amended 24-Nov)", () => {
  const now = ist("2026-11-15T12:00");
  test("with unload times both are valid and each gets its own check", () => {
    const drums = [drum("a", "879", "2026-11-14T07:00"), drum("b", "879", "2026-11-14T15:00")];
    const o = matchDrums(drums, [log("c1", "879", "2026-11-14T09:00"), log("c2", "879", "2026-11-14T22:30")], now, LIMIT);
    expect(o.get("a")).toEqual({ kind: "CURED", logId: "c1" });
    expect(o.get("b")).toEqual({ kind: "LATE", logId: "c2", hoursLate: 1.5 });
    // only the second one was cured: the first stays Missing
    const o2 = matchDrums(drums, [log("c2", "879", "2026-11-14T16:00")], now, LIMIT);
    expect(o2.get("a")?.kind).toBe("MISSING");
    expect(o2.get("b")).toEqual({ kind: "CURED", logId: "c2" });
  });
  test("without unload times: Data error, no auto-match", () => {
    const drums = [drum("a", "879", null, "2026-11-14"), drum("b", "879", null, "2026-11-14")];
    const o = matchDrums(drums, [log("c1", "879", "2026-11-14T09:00")], now, LIMIT);
    expect(o.get("a")).toEqual({ kind: "DATA_ERROR" });
    expect(o.get("b")).toEqual({ kind: "DATA_ERROR" });
    expect(deriveDrumStatus({ isCuringItem: true, match: "DATA_ERROR", latest: null }, now, GRACE)).toBe("DATA_ERROR");
    expect(trackerAuto(null, { kind: "DATA_ERROR" }, null, now)).toMatchObject({ status: "DATA_ERROR", closedAt: null });
  });
  test("once a person links one of them, the other is matched normally", () => {
    const drums = [drum("a", "879", null, "2026-11-14"), drum("b", "879", null, "2026-11-14")];
    const o = matchDrums(drums, [log("c1", "879", "2026-11-14T09:00", "a"), log("c2", "879", "2026-11-14T20:00")], now, LIMIT);
    expect(o.get("a")).toEqual({ kind: "MATCHED_TIME_UNKNOWN", logId: "c1" });
    expect(o.get("b")).toEqual({ kind: "MATCHED_TIME_UNKNOWN", logId: "c2" });
  });
});

test("acceptance 6 – short curing hours: Under-cured, alert to level 1 at once", () => {
  const recipe = { approvedCuringHrs: 8, waitBeforeTestHrs: 24 };
  const f = computeCuringFields(ist("2026-11-24T08:00"), ist("2026-11-24T15:20"), recipe);
  expect(f).toMatchObject({ plannedCuringHrs: 8, actualCuringHrs: 7.33, hoursDeviation: -0.67, timeCheck: "UNDER_CURED" });
  expect(computeCuringFields(ist("2026-11-24T08:00"), ist("2026-11-24T16:00"), recipe).timeCheck).toBe("OK");
  expect(computeCuringFields(ist("2026-11-24T08:00"), null, recipe)).toMatchObject({ actualCuringHrs: null, timeCheck: null, testDueAt: null });
  expect(computeCuringFields(ist("2026-11-24T08:00"), ist("2026-11-24T16:00"), null)).toMatchObject({ timeCheck: "NO_RECIPE", plannedCuringHrs: null, testDueAt: null });
  const rules: LevelRule[] = [
    { level: 1, anchor: "FROM_EVENT", delayMinutes: 0 },
    { level: 2, anchor: "FROM_EVENT", delayMinutes: 1440 },
  ];
  expect(dueLevels(rules, { FROM_EVENT: ist("2026-11-24T15:20") }, new Set(), ist("2026-11-24T15:21")).map((l) => l.level)).toEqual([1]);
});

test("acceptance 7 – test due passed, no result: overdue 2 h after test due", () => {
  const end = ist("2026-11-24T16:00");
  const { testDueAt } = computeCuringFields(ist("2026-11-24T08:00"), end, { approvedCuringHrs: 8, waitBeforeTestHrs: 24 });
  expect(testDueAt).toEqual(ist("2026-11-25T16:00"));
  const latest = { curingEndAt: end, testDueAt, testResult: null, onOpenRequisition: false, sentDate: null };
  const status = (now: string) => deriveDrumStatus({ isCuringItem: true, match: "CURED", latest }, ist(now), GRACE);
  expect(deriveDrumStatus({ isCuringItem: true, match: "CURED", latest: { ...latest, curingEndAt: null, testDueAt: null } }, end, GRACE)).toBe("IN_CURING");
  expect(status("2026-11-25T18:00")).toBe("AWAITING_TEST");
  expect(status("2026-11-25T18:01")).toBe("TEST_OVERDUE");
  const rules: LevelRule[] = [{ level: 1, anchor: "FROM_TEST_DUE", delayMinutes: 120 }];
  expect(dueLevels(rules, { FROM_TEST_DUE: testDueAt }, new Set(), ist("2026-11-25T17:59"))).toEqual([]);
  expect(dueLevels(rules, { FROM_TEST_DUE: testDueAt }, new Set(), ist("2026-11-25T18:01"))).toHaveLength(1);
});

test("acceptance 8 – failed sample: Failed (hold), whatever the requisition says", () => {
  const latest = { curingEndAt: ist("2026-11-24T16:00"), testDueAt: ist("2026-11-25T16:00"), testResult: "FAIL" as const, onOpenRequisition: true, sentDate: null };
  expect(deriveDrumStatus({ isCuringItem: true, match: "CURED", latest }, ist("2026-11-26T10:00"), GRACE)).toBe("FAILED");
  expect(renderAlert("TEST_FAILED", 1, [{ text: "Lot L-9 · Drum 882 · 1,509 m" }])).toContain("Do not send");
});

test("acceptance 9 – passed drum: Passed, message carries lot, drum and length", () => {
  const latest = { curingEndAt: ist("2026-11-24T16:00"), testDueAt: ist("2026-11-25T16:00"), testResult: "PASS" as const, onOpenRequisition: false, sentDate: null };
  const at = ist("2026-11-27T10:00"); // long past test due: a result ends "overdue"
  expect(deriveDrumStatus({ isCuringItem: true, match: "CURED", latest }, at, GRACE)).toBe("PASSED");
  expect(deriveDrumStatus({ isCuringItem: true, match: "CURED", latest: { ...latest, onOpenRequisition: true } }, at, GRACE)).toBe("REQUISITION_RAISED");
  expect(deriveDrumStatus({ isCuringItem: true, match: "CURED", latest: { ...latest, sentDate: at } }, at, GRACE)).toBe("SENT");
  const text = renderAlert("PASSED_NO_REQUISITION", 1, [
    { text: "Lot L-123 · Drum 882 · 1,509 m", lengthM: 1509 },
    { text: "Lot L-124 · Drum 885 · 1,509 m", lengthM: 1509 },
  ]);
  expect(text).toContain("Lot L-123 · Drum 882 · 1,509 m");
  expect(text).toContain("Total 3.02 km");
});

test("acceptance 10 – job run twice: a level that already fired is not due again", () => {
  const anchors = { FROM_UNLOAD: ist("2026-11-24T08:00") };
  const now = ist("2026-11-24T14:30");
  const first = dueLevels(drumRules, anchors, new Set(), now).map((l) => l.level);
  expect(first).toEqual([1]);
  expect(dueLevels(drumRules, anchors, new Set(first), now)).toEqual([]);
  // a trigger whose anchor is not known for this object never fires
  expect(dueLevels(drumRules, { FROM_UNLOAD: null }, new Set(), now)).toEqual([]);
});

test("acceptance 12 – manual remarks survive: the tracker update holds AUTO columns only", () => {
  const auto = ["status", "curingLogId", "curingStartAt", "hoursLate", "closedAt"];
  const now = ist("2026-11-24T18:00");
  const existing = { status: "MISSING" as const, curingLogId: null, curingStartAt: null, hoursLate: null, closedAt: null, reason: "TANK_FULL", remarks: "tank 2 full", mdRemarks: "why?", manualUpdatedBy: "kuntal", manualUpdatedAt: now };
  const outcomes = [
    { kind: "MISSING", hoursSinceUnload: 7 },
    { kind: "LATE", logId: "c1", hoursLate: 1 },
    { kind: "CURED", logId: "c1" },
    { kind: "MATCHED_TIME_UNKNOWN", logId: "c1" },
    { kind: "DATA_ERROR" },
    { kind: "PENDING" },
    { kind: "TIME_UNKNOWN" },
    null,
  ] as const;
  for (const o of outcomes) expect(Object.keys(trackerAuto(existing, o, now, now)!).sort()).toEqual([...auto].sort());
});

test("acceptance 13 – unknown unload time: never Missing, no 6-hour alert, left out of compliance", () => {
  const d = drum("d1", "915", null, "2026-11-10");
  const now = ist("2026-11-24T12:00");
  expect(matchDrums([d], [], now, LIMIT).get("d1")).toEqual({ kind: "TIME_UNKNOWN" });
  expect(deriveDrumStatus({ isCuringItem: true, match: "TIME_UNKNOWN", latest: null }, now, GRACE)).toBe("MADE");
  expect(trackerAuto(null, { kind: "TIME_UNKNOWN" }, null, now)).toBeNull();
  expect(dueLevels(drumRules, { FROM_UNLOAD: d.unloadedAt }, new Set(), now)).toEqual([]);
  // still matched by date when there is no doubt, but not judged on time / late
  expect(matchDrums([d], [log("c1", "915", "2026-11-11T09:00")], now, LIMIT).get("d1")).toEqual({ kind: "MATCHED_TIME_UNKNOWN", logId: "c1" });
  const c = compliance(
    [
      { unloadedAt: null, curingStartAt: null, dataError: false },
      { unloadedAt: ist("2026-11-24T01:00"), curingStartAt: ist("2026-11-24T05:00"), dataError: false }, // on time
      { unloadedAt: ist("2026-11-24T02:00"), curingStartAt: ist("2026-11-24T09:00"), dataError: false }, // late
      { unloadedAt: ist("2026-11-24T03:00"), curingStartAt: null, dataError: false }, // missing
      { unloadedAt: ist("2026-11-24T03:00"), curingStartAt: null, dataError: true }, // left out
      { unloadedAt: ist("2026-11-24T10:00"), curingStartAt: null, dataError: false }, // not due yet
    ],
    now,
    LIMIT,
  );
  expect(c).toMatchObject({ due: 3, onTime: 1, unknownTime: 1 });
  expect(c.pct).toBeCloseTo(33.33, 1);
  expect(compliance([], now, LIMIT).pct).toBeNull();
});

test("acceptance 14 – non-curing item is excluded from Missing", () => {
  const now = ist("2026-11-24T12:00");
  expect(deriveDrumStatus({ isCuringItem: false, match: "MISSING", latest: null }, now, GRACE)).toBe("NOT_CURING_ITEM");
  // a drum that stops being a curing item: its open tracker row is closed, not deleted
  const open = { status: "MISSING" as const, curingLogId: null, curingStartAt: null, hoursLate: null, closedAt: null };
  expect(trackerAuto(open, null, null, now)).toMatchObject({ status: "MISSING", closedAt: now });
  expect(trackerAuto(null, null, null, now)).toBeNull();
});

test("looksLikeCuringItem – product names from prisma/seed.ts", () => {
  const cured = [
    "COVERED CONDUCTOR - 100 SQ. MM. (AAAC) - 11 KV (SIO/AL-7) (IS)",
    "100 SQ. MM. (AAAC) - 11KV COVERED CONDUCTOR (INSULATED) (TPWODL)",
    "300 SQ. MM. CORE INSULATED 11kv (TPNODL/GENERAL) (XLPE/SIO)",
    "300 SQ. MM. CORE INSULATED 11kv (XLPE/SIO - SBPDCL/GENERAL)",
    "300 SQ. MM. CORE INSULATED 11kv (SIO) (CESC) (IS)",
    "300 SQ. MM. CORE INSULATED 11kv (XLPE/SIOPLASS - SPECIAL)",
    "400 SQ. MM. CORE INSULATED 11kv (SIO) (TPSODL - GENERAL)",
    "630 SQ. MM. CORE INSULATED 11kv (GENERAL) (SIO)",
    "630 SQ. MM. CORE INSULATED 11kv (SIO) (IS)",
    "630 SQ. MM. CORE INSULATED 33kv (SIO) (TATA/GENERAL)",
  ];
  for (const name of cured) expect(looksLikeCuringItem(name), name).toBe(true);
  expect(looksLikeCuringItem("630 SQ. MM. COMPACT CONDUCTOR - IS")).toBe(false);
});

test("shiftOf – night shift crosses midnight", () => {
  const shifts = [
    { code: "MORNING", startTime: "06:00", endTime: "14:00" },
    { code: "AFTERNOON", startTime: "14:00", endTime: "22:00" },
    { code: "NIGHT", startTime: "22:00", endTime: "06:00" },
  ];
  expect(shiftOf(ist("2026-11-24T06:00"), shifts)).toBe("MORNING");
  expect(shiftOf(ist("2026-11-24T13:59"), shifts)).toBe("MORNING");
  expect(shiftOf(ist("2026-11-24T14:00"), shifts)).toBe("AFTERNOON");
  expect(shiftOf(ist("2026-11-24T23:30"), shifts)).toBe("NIGHT");
  expect(shiftOf(ist("2026-11-25T00:10"), shifts)).toBe("NIGHT");
  expect(shiftOf(ist("2026-11-25T05:59"), shifts)).toBe("NIGHT");
  expect(shiftOf(ist("2026-11-24T10:00"), [shifts[2]])).toBeNull();
});

test("pass rate – passed ÷ (passed + failed)", () => {
  expect(passRate(["PASS", "PASS", "PASS", "FAIL"])).toBe(75);
  expect(passRate([])).toBeNull();
});

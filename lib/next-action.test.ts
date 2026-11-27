import { expect, test } from "vitest";
import { countdownText, nextAction, type ActionLog } from "./next-action";

const S = { curingStartLimitHours: 6, testOverdueGraceHours: 2 };
// IST = UTC + 5:30, so 03:40Z is 09:10 IST.
const ist = (hhmm: string, day = "2026-11-27") => new Date(`${day}T${hhmm}:00+05:30`);
const log = (p: Partial<ActionLog> = {}): ActionLog => ({
  curingStartAt: ist("10:00"),
  curingEndAt: null,
  plannedCuringHrs: 8,
  testDueAt: null,
  testedAt: null,
  requisitionRaisedAt: null,
  ...p,
});

test("unloaded drum: put in tank within the limit", () => {
  const drum = { status: "MADE" as const, unloadedAt: ist("09:10") };
  const a = nextAction(drum, null, ist("10:00"), S);
  expect(a).toMatchObject({ step: 1, action: "load", tone: "green", kind: "curing", trigger: "Unloaded 09:10 → put in tank by 15:10" });
  expect(a.deadline).toEqual(ist("15:10"));
  expect(nextAction(drum, null, ist("13:10"), S).tone).toBe("amber"); // exactly 2 h left
  expect(nextAction(drum, null, ist("15:11"), S).tone).toBe("red");
  // The rules engine's status wins even if the clock here disagrees.
  expect(nextAction({ ...drum, status: "MISSING" }, null, ist("10:00"), S).tone).toBe("red");
});

test("no unload time: no deadline", () => {
  const a = nextAction({ status: "MADE", unloadedAt: null }, null, ist("10:00"), S);
  expect(a).toMatchObject({ action: "load", deadline: null, tone: "green" });
  expect(a.trigger).toContain("Unload time not known");
});

test("in curing: end at start + recipe hours", () => {
  const drum = { status: "IN_CURING" as const, unloadedAt: ist("09:10") };
  const a = nextAction(drum, log(), ist("12:00"), S);
  expect(a).toMatchObject({ step: 2, action: "endCuring", tone: "green", kind: "curing", trigger: "Curing started 10:00 → end at 18:00 (recipe 8 h)" });
  expect(nextAction(drum, log(), ist("17:00"), S).tone).toBe("amber");
  expect(nextAction(drum, log(), ist("18:30"), S).tone).toBe("red");
  expect(nextAction(drum, log({ plannedCuringHrs: null }), ist("23:00"), S)).toMatchObject({ deadline: null, tone: "green" });
});

test("lab: test due, amber through the grace hours, red when overdue", () => {
  const l = log({ curingEndAt: ist("18:00", "2026-11-26"), testDueAt: ist("14:00") });
  const drum = { status: "AWAITING_TEST" as const, unloadedAt: null };
  expect(nextAction(drum, l, ist("09:00"), S)).toMatchObject({ step: 3, action: "test", tone: "green", kind: "lab", trigger: "Test due 27-Nov 14:00" });
  expect(nextAction(drum, l, ist("15:00"), S).tone).toBe("amber");
  expect(nextAction(drum, l, ist("16:01"), S).tone).toBe("red");
  expect(nextAction({ ...drum, status: "TEST_OVERDUE" }, l, ist("09:00"), S).tone).toBe("red");
});

test("failed, passed, requisition raised", () => {
  const now = ist("10:00");
  const l = log({ testedAt: ist("16:00", "2026-11-26"), requisitionRaisedAt: ist("09:00") });
  expect(nextAction({ status: "FAILED", unloadedAt: null }, l, now, S)).toMatchObject({ step: 4, action: "none", tone: "red", kind: "curing" });
  const passed = nextAction({ status: "PASSED", unloadedAt: null }, l, now, S);
  expect(passed).toMatchObject({ step: 5, action: "requisition", deadline: null, tone: "green", kind: "transfer", trigger: "Passed 26-Nov 16:00 → raise requisition" });
  expect(passed.since).toEqual(l.testedAt);
  expect(nextAction({ status: "REQUISITION_RAISED", unloadedAt: null }, l, now, S)).toMatchObject({
    step: 6,
    action: "dispatch",
    kind: "transfer",
    trigger: "Requisition raised 09:00 → dispatch to Polypark",
  });
});

test("countdown text", () => {
  expect(countdownText(ist("15:10").getTime(), ist("12:55").getTime())).toBe("2 h 15 m बाकी / left");
  expect(countdownText(ist("15:10").getTime(), ist("18:15").getTime())).toBe("3 h 05 m देर / late");
});

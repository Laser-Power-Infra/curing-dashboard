import { expect, test } from "vitest";
import { fmtDateTime, fmtDuration, fmtKm, fmtM, istDay, parseIstInput, toIstInput } from "./format";

test("IST formatting and parsing", () => {
  const d = new Date("2026-11-24T09:00:00Z"); // 14:30 IST
  expect(fmtDateTime(d)).toBe("24-Nov 14:30");
  expect(toIstInput(d)).toBe("2026-11-24T14:30");
  expect(parseIstInput("2026-11-24T14:30")?.toISOString()).toBe(d.toISOString());
  // 23:00 UTC is already the next day in IST
  expect(istDay(new Date("2026-11-24T23:00:00Z")).toISOString()).toBe("2026-11-25T00:00:00.000Z");
  expect(fmtDuration(7 + 20 / 60)).toBe("7 h 20 m");
  expect(fmtM(5075)).toBe("5,075 m");
  expect(fmtKm(3018)).toBe("3.02 km");
});

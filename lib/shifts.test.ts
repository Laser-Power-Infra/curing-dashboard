import { expect, test } from "vitest";
import { currentShift, shiftWindow } from "./shifts";

const shifts = [
  { code: "MORNING", startTime: "06:00", endTime: "14:00" },
  { code: "AFTERNOON", startTime: "14:00", endTime: "22:00" },
  { code: "NIGHT", startTime: "22:00", endTime: "06:00" },
];
const day = new Date("2026-11-24T00:00:00Z");

test("night shift ends the next morning (IST)", () => {
  const w = shiftWindow(day, shifts[2]);
  expect(w.start.toISOString()).toBe("2026-11-24T16:30:00.000Z"); // 24-Nov 22:00 IST
  expect(w.end.toISOString()).toBe("2026-11-25T00:30:00.000Z"); // 25-Nov 06:00 IST
  expect(shiftWindow(day, shifts[0]).end.toISOString()).toBe("2026-11-24T08:30:00.000Z"); // 14:00 IST
});

test("02:00 IST belongs to yesterday's night shift", () => {
  const at = currentShift(new Date("2026-11-24T20:30:00Z"), shifts); // 25-Nov 02:00 IST
  expect(at?.shift.code).toBe("NIGHT");
  expect(at?.day.toISOString()).toBe(day.toISOString());
  expect(currentShift(new Date("2026-11-24T08:30:00Z"), shifts)?.shift.code).toBe("AFTERNOON"); // 14:00 sharp
});

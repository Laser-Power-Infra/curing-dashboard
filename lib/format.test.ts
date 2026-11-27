import { expect, test } from "vitest";
import { fmtDateTime, fmtDuration, fmtKm, fmtM, istDay, parseIstInput, sizeTag, toIstInput } from "./format";

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

test("sizeTag reads size and voltage from the item name", () => {
  expect(sizeTag("300 SQ. MM. CORE INSULATED 33kv (SIO/GENERAL)")).toBe("300 sq mm · 33 kV");
  expect(sizeTag("COVERED CONDUCTOR - 70 SQ. MM.(XLPE) (AAAC-7/3.57) - 11 KV (SIO) (GENERAL)")).toBe("70 sq mm · 11 kV");
  expect(sizeTag("100 SQ. MM. (AAAC) - 11KV COVERED CONDUCTOR (INSULATED) (TPWODL)")).toBe("100 sq mm · 11 kV");
  expect(sizeTag("PROCESS DRUM")).toBe("");
  expect(sizeTag(null)).toBe("");
});

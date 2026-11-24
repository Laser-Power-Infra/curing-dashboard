import { expect, test } from "vitest";
import { qs, sentSince } from "./shared";

test("sentSince: IST day and Monday week start", () => {
  // Tue 24-Nov-26 01:00 IST = Mon 23-Nov 19:30 UTC
  const now = new Date("2026-11-23T19:30:00Z");
  expect(sentSince("today", now)?.toISOString()).toBe("2026-11-23T18:30:00.000Z"); // 24-Nov 00:00 IST
  expect(sentSince("week", now)?.toISOString()).toBe("2026-11-22T18:30:00.000Z"); // Mon 23-Nov 00:00 IST
  // Sunday belongs to the week that started six days earlier.
  expect(sentSince("week", new Date("2026-11-29T10:00:00Z"))?.toISOString()).toBe("2026-11-22T18:30:00.000Z");
  expect(sentSince("other", now)).toBeNull();
});

test("qs drops empty values", () => {
  expect(qs({ status: "MISSING", line: undefined, q: "" })).toBe("?status=MISSING");
  expect(qs({})).toBe("");
});

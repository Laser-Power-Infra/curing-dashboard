import { expect, test } from "vitest";
import { collapseSamples, parseCsv, sheetDate, sheetNumber, sheetTime, toRecords } from "./sheet-import";

test("parseCsv – quoted commas, doubled quotes, newlines in a cell", () => {
  expect(parseCsv('a,"6,030","say ""hi""","two\nlines"\r\nb,,\n')).toEqual([["a", "6,030", 'say "hi"', "two\nlines"], ["b", "", ""]]);
});

test("toRecords – finds the header row, skips blank rows, keeps the sheet row number", () => {
  const recs = toRecords([["title"], ["Lot No", " Drum "], ["176", "1214"], ["", ""], ["177", "1212"]], "Lot No");
  expect(recs).toEqual([{ "Lot No": "176", Drum: "1214", _row: "3" }, { "Lot No": "177", Drum: "1212", _row: "5" }]);
  expect(() => toRecords([["x"]], "Lot No")).toThrow();
});

test("sheetDate, sheetTime, sheetNumber", () => {
  expect(sheetDate("05-Aug-26")).toBe("2026-08-05");
  expect(sheetDate("30-Sep-2026")).toBe("2026-09-30");
  expect(sheetDate("06-Aug-26 16:50")).toBe("2026-08-06");
  expect(sheetDate("31-Feb-26")).toBeNull();
  expect(sheetDate("")).toBeNull();
  expect(sheetTime("2:50 pm")).toBe("14:50");
  expect(sheetTime("12:05 am")).toBe("00:05");
  expect(sheetTime("12:05 PM")).toBe("12:05");
  expect(sheetTime("3:44")).toBe("03:44");
  expect(sheetTime("25:00")).toBeNull();
  expect(sheetNumber("6,030")).toBe(6030);
  expect(sheetNumber("")).toBeNull();
});

test("collapseSamples – the sheet's Test Result rule", () => {
  const s = (lot: string, drum: string, result: string, testType = "First") => ({ lot, drum, testType, result });
  // Own samples win over the rest of the lot.
  expect(collapseSamples([s("1", "A", "Pass"), s("1", "B", "Fail")], "1", "A").result).toBe("PASS");
  // No sample for this drum → the whole lot's samples decide; one Fail is a Fail.
  expect(collapseSamples([s("1", "B", "Pass"), s("1", "C", "Fail")], "1", "A").result).toBe("FAIL");
  // A retest replaces the first test.
  expect(collapseSamples([s("1", "A", "Fail"), s("1", "A", "Pass", "Retest")], "1", "A").result).toBe("PASS");
  // Nothing measured → no result.
  expect(collapseSamples([s("1", "A", "Incomplete")], "1", "A").result).toBeNull();
  expect(collapseSamples([s("2", "A", "Pass")], "1", "A")).toEqual({ used: [], result: null });
});

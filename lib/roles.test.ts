import { expect, test } from "vitest";
import { parseRoles, rolesText } from "./roles";

test("parseRoles – what a person types in the role column", () => {
  expect(parseRoles("user")).toEqual([]);
  expect(parseRoles("admin")).toEqual(["ADMIN"]);
  expect(parseRoles(" Admin ")).toEqual(["ADMIN"]);
  expect(parseRoles("lab, production head")).toEqual(["PRODUCTION_HEAD", "LAB"]);
  expect(parseRoles("superuser")).toEqual([]);
  expect(parseRoles(null)).toEqual([]);
});

test("rolesText – what the Settings screen saves", () => {
  expect(rolesText([])).toBe("user");
  expect(rolesText(["ADMIN"])).toBe("admin");
  expect(rolesText(["LAB", "PRODUCTION_HEAD"])).toBe("lab, production_head");
  expect(parseRoles(rolesText(["LAB", "PRODUCTION_HEAD"]))).toEqual(["PRODUCTION_HEAD", "LAB"]);
});

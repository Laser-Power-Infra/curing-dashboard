import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./password";

test("verifies the right password and rejects everything else", () => {
  const stored = hashPassword("correct horse");
  expect(verifyPassword("correct horse", stored)).toBe(true);
  expect(verifyPassword("wrong horse", stored)).toBe(false);
  expect(verifyPassword("correct horse", "not-a-hash")).toBe(false);
  expect(hashPassword("correct horse")).not.toBe(stored); // fresh salt each time
});

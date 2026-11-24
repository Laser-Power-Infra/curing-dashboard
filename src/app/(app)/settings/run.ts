// Shared wrapper for the server actions of the transfers, boiler and settings screens.
import { can, requireUser, type Perm, type SessionUser } from "@/lib/auth";
import { runRules } from "@/lib/rules";
import { Prisma } from "@/generated/prisma/client";
import type { ActionState } from "@/components/ui/client";

/** A refusal the user should read as written (validation, stale data). */
export class Fail extends Error {}

export const isUniqueClash = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Permission check, then `fn`. Only `Fail` messages reach the user; anything else is logged. */
export async function run(perm: Perm, fn: (user: SessionUser) => Promise<string>): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, perm)) return { ok: false, message: "You don't have permission to do this." };
  try {
    return { ok: true, message: await fn(user) };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, message: e.message };
    if (isUniqueClash(e)) return { ok: false, message: "That name, code or email is already in use." };
    console.error(e);
    return { ok: false, message: "Could not save. Please try again." };
  }
}

/** Re-run the rules after a committed save. A rules failure must not look like a failed save. */
export async function refreshStatuses(by: string): Promise<string> {
  try {
    await runRules(by);
    return "";
  } catch (e) {
    console.error(e);
    return " Statuses will refresh at the next hourly check.";
  }
}

export const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/** A required number within [min, max], or a Fail naming the field. */
export function num(fd: FormData, key: string, label: string, min: number, max: number): number {
  const s = str(fd, key);
  const n = Number(s);
  if (!s || !Number.isFinite(n) || n < min || n > max) throw new Fail(`${label} must be a number from ${min} to ${max}.`);
  return n;
}

/** Field-by-field old → new map for audit(). */
export const diff = <T extends Record<string, unknown>>(old: Record<string, unknown>, data: T) =>
  Object.fromEntries(Object.keys(data).map((k) => [k, { old: old[k], new: data[k] }]));

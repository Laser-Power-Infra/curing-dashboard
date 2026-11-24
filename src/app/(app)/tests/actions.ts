"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runRules } from "@/lib/rules";
import { parseIstInput } from "@/lib/format";
import type { ActionState } from "@/components/ui/client";

const SKEW_MS = 5 * 60_000; // phone clocks run a few minutes off
const fail = (message: string, fieldErrors?: Record<string, string>): ActionState => ({ ok: false, message, fieldErrors });
const READINGS = ["gaugeLengthMm", "lengthUnderLoadMm", "lengthAfterCoolingMm"];

// The % values and readings are stored as typed, for reference only: Pass / Fail is never worked out from them (guide 5.6).
export async function createTest(fd: FormData): Promise<ActionState> {
  const user = await requirePerm("testEntry");
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const e: Record<string, string> = {};
  const num = (k: string) => {
    if (!s(k)) return null;
    const n = Number(s(k));
    if (Number.isFinite(n) && Math.abs(n) < 1000) return n;
    e[k] = "Enter a number";
    return null;
  };

  const log = await prisma.curingLog.findUnique({ where: { id: s("curingLogId") }, include: { hotSetTests: { take: 1 } } });
  if (!log) return fail("Curing entry not found");
  if (!log.curingEndAt) return fail("Curing has not ended for this drum yet");
  if (log.testResult || log.hotSetTests.length) return fail("A result is already entered for this drum");

  const result = s("result");
  const testedAt = parseIstInput(s("testedAt"));
  const hotSetPct = num("hotSetPct");
  const permanentSetPct = num("permanentSetPct");
  const readings = Object.fromEntries(READINGS.map((k) => [k, num(k)]).filter(([, v]) => v != null));
  if (result !== "PASS" && result !== "FAIL") e.result = "Choose Pass or Fail";
  if (!testedAt) e.testedAt = "Enter when the test was done";
  else if (testedAt.getTime() > Date.now() + SKEW_MS) e.testedAt = "Test time is in the future";
  else if (testedAt < log.curingEndAt) e.testedAt = "Test time is before curing ended";
  if ((result !== "PASS" && result !== "FAIL") || !testedAt || Object.keys(e).length) return fail("Please check the marked fields", e);

  const test = await prisma.hotSetTest.create({
    data: {
      curingLogId: log.id,
      drumId: log.drumId,
      lotNo: log.lotNo,
      sampleEnd: s("sampleEnd") || null,
      testType: s("testType") || null,
      readings: Object.keys(readings).length ? readings : undefined,
      hotSetPct,
      permanentSetPct,
      result,
      testedAt,
      testedBy: user.email,
      remarks: s("remarks") || null,
      createdBy: user.email,
    },
  });
  await audit("hot_set_tests", test.id, "CREATE", null, user.email);
  await runRules(user.email);
  revalidatePath("/tests");
  redirect("/tests");
}

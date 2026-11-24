"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { computeCuringFields, findRecipe, runRules } from "@/lib/rules";
import { fmtDateOnly, fmtDateTime, istDayStart, parseIstInput } from "@/lib/format";
import type { ActionState } from "@/components/ui/client";

const SKEW_MS = 5 * 60_000; // phone clocks run a few minutes off
const fail = (message: string, fieldErrors?: Record<string, string>): ActionState => ({ ok: false, message, fieldErrors });
const hrs = (n: number) => `${+n.toFixed(2)} h`;

export async function lookupRecipe(compound: string, productId: string) {
  await requirePerm("curingEntry");
  return findRecipe(compound.trim(), productId);
}

export async function createCuring(fd: FormData): Promise<ActionState> {
  const user = await requirePerm("curingEntry");
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const compound = s("xlpeCompound");
  const start = parseIstInput(s("curingStartAt"));
  const [drum, unit] = await Promise.all([
    prisma.drum.findFirst({
      where: { id: s("drumId"), isCuringItem: true, line: { inScope: true } },
      include: { curingLogs: { orderBy: { cycleNo: "desc" }, take: 1 } },
    }),
    prisma.curingUnit.findFirst({ where: { id: s("curingUnitId"), active: true } }),
  ]);

  const e: Record<string, string> = {};
  if (!drum) e.drumId = "Choose a drum from the list";
  if (!unit) e.curingUnitId = "Choose the tank / chamber";
  if (!compound) e.xlpeCompound = "Enter the XLPE compound";
  if (!start) e.curingStartAt = "Enter the start time";
  else if (start.getTime() > Date.now() + SKEW_MS) e.curingStartAt = "Start time is in the future";
  else if (drum?.unloadedAt && start <= drum.unloadedAt) e.curingStartAt = `Start time is before this drum was unloaded (${fmtDateTime(drum.unloadedAt)})`;
  else if (drum && start < istDayStart(drum.unloadDate)) e.curingStartAt = `Start time is before this drum's unload date (${fmtDateOnly(drum.unloadDate)})`;
  if (!drum || !unit || !start || Object.keys(e).length) return fail("Please check the marked fields", e);

  const last = drum.curingLogs[0];
  if (last && last.testResult !== "FAIL") return fail("This drum already has a curing entry");

  const recipe = drum.productId ? await findRecipe(compound, drum.productId) : null;
  let log;
  try {
    log = await prisma.curingLog.create({
      data: {
        lotNo: s("lotNo") || null,
        cycleNo: (last?.cycleNo ?? 0) + 1,
        drumId: drum.id,
        matchMethod: "MANUAL",
        matchedAt: new Date(),
        coreProductionDate: drum.unloadDate,
        productId: drum.productId,
        productName: drum.coreItem,
        coreDrumNo: drum.drumNo,
        lengthM: drum.lengthM,
        xlpeCompound: compound,
        curingUnitId: unit.id,
        curingStartAt: start,
        recipeId: recipe?.id,
        ...computeCuringFields(start, null, recipe),
        remarks: s("remarks") || null,
        createdBy: user.email,
      },
    });
  } catch (err) {
    // @@unique([drumId, cycleNo]): someone else saved this drum's entry first.
    if ((err as { code?: string }).code === "P2002") return fail("This drum already has a curing entry");
    throw err;
  }
  await audit("curing_logs", log.id, "CREATE", null, user.email);
  await runRules(user.email);
  revalidatePath("/curing");
  redirect("/curing");
}

export async function endCuring(fd: FormData): Promise<ActionState> {
  const user = await requirePerm("curingEntry");
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const log = await prisma.curingLog.findUnique({ where: { id: s("id") } });
  if (!log) return fail("Curing entry not found");
  if (log.curingEndAt) return fail("Curing has already been ended for this entry");

  const end = parseIstInput(s("curingEndAt"));
  const visualCheck = s("visualCheck");
  const visualNote = s("visualNote") || null;
  const e: Record<string, string> = {};
  if (!end) e.curingEndAt = "Enter the end time";
  else if (end <= log.curingStartAt) e.curingEndAt = "End time is before start time";
  else if (end.getTime() > Date.now() + SKEW_MS) e.curingEndAt = "End time is in the future";
  if (visualCheck !== "OK" && visualCheck !== "NOT_OK") e.visualCheck = "Choose OK or Not OK";
  else if (visualCheck === "NOT_OK" && !visualNote) e.visualNote = "Say what is wrong with the drum";
  if (!end || (visualCheck !== "OK" && visualCheck !== "NOT_OK") || Object.keys(e).length) return fail("Please check the marked fields", e);

  const recipe = log.xlpeCompound && log.productId ? await findRecipe(log.xlpeCompound, log.productId) : null;
  const f = computeCuringFields(log.curingStartAt, end, recipe);
  if (f.timeCheck === "UNDER_CURED" && fd.get("confirmUnder") !== "on")
    return fail("Tick the box to confirm this drum is Under-cured", {
      confirmUnder: `Actual ${hrs(f.actualCuringHrs ?? 0)} is less than approved ${hrs(f.plannedCuringHrs ?? 0)} – this will be marked Under-cured`,
    });

  const { count } = await prisma.curingLog.updateMany({
    where: { id: log.id, curingEndAt: null },
    data: { curingEndAt: end, visualCheck, visualNote, recipeId: recipe?.id ?? null, ...f, updatedBy: user.email },
  });
  if (!count) return fail("Curing has already been ended for this entry");
  await audit(
    "curing_logs",
    log.id,
    "UPDATE",
    {
      curingEndAt: { old: null, new: end },
      visualCheck: { old: log.visualCheck, new: visualCheck },
      visualNote: { old: log.visualNote, new: visualNote },
      actualCuringHrs: { old: log.actualCuringHrs, new: f.actualCuringHrs },
      timeCheck: { old: log.timeCheck, new: f.timeCheck },
    },
    user.email,
  );
  await runRules(user.email);
  revalidatePath("/curing");
  redirect("/curing");
}

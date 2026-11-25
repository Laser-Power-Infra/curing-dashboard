"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { looksLikeCuringItem, runRules } from "@/services/rules";
import { istDay, parseIstInput } from "@/lib/format";
import type { ActionState } from "@/components/ui/client";

export type DrumState = (NonNullable<ActionState> & { duplicateId?: string }) | null;

const SKEW_MS = 5 * 60_000; // phone clocks run a few minutes off

export async function createDrum(fd: FormData): Promise<DrumState> {
  const user = await requirePerm("unloadEntry");
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const gridEntryId = s("gridEntryId");
  const drumNo = s("drumNo");
  const coreItem = s("coreItem");
  const unloadedAt = parseIstInput(s("unloadedAt"));
  const lengthM = Number(s("lengthM"));
  const line = await prisma.line.findFirst({ where: { id: s("lineId"), inScope: true, active: true } });

  const e: Record<string, string> = {};
  if (!gridEntryId) e.gridEntryId = "Enter the Grid entry ID";
  if (!line) e.lineId = "Choose the line";
  if (!unloadedAt) e.unloadedAt = "Enter the unload date and time";
  else if (unloadedAt.getTime() > Date.now() + SKEW_MS) e.unloadedAt = "Unload time is in the future";
  if (!drumNo) e.drumNo = "Enter the drum no";
  if (!coreItem) e.coreItem = "Enter the core item";
  if (!(lengthM > 0 && lengthM < 1e6)) e.lengthM = "Enter the length in metres (more than 0)";
  if (!line || !unloadedAt || Object.keys(e).length) return { ok: false, message: "Please check the marked fields", fieldErrors: e };

  const product = await prisma.product.findFirst({ where: { name: coreItem, active: true } });
  let drum;
  try {
    drum = await prisma.drum.create({
      data: {
        gridEntryId,
        lineId: line.id,
        unloadDate: istDay(unloadedAt),
        unloadedAt,
        unloadTimeSource: "MANUAL",
        prodOrders: s("prodOrders").split(",").map((x) => x.trim()).filter(Boolean),
        mcNo: s("mcNo") || null,
        party: s("party") || null,
        coreItem,
        productId: product?.id,
        isCuringItem: product ? product.isCuringItem : looksLikeCuringItem(coreItem),
        drumNo,
        drumSize: s("drumSize") || null,
        lengthM,
        enteredBy: user.email,
        source: "MANUAL",
        createdBy: user.email,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;
    const dup = await prisma.drum.findUnique({ where: { gridEntryId }, select: { id: true } });
    return { ok: false, message: `Grid ID ${gridEntryId} is already entered`, duplicateId: dup?.id };
  }
  await audit("drums", drum.id, "CREATE", null, user.email);
  await runRules(user.email);
  revalidatePath("/unload");
  return { ok: true, message: `Drum ${drumNo} saved` };
}

export async function setUnloadTime(fd: FormData): Promise<ActionState> {
  const user = await requirePerm("unloadEntry");
  const drum = await prisma.drum.findUnique({ where: { id: String(fd.get("drumId") ?? "") } });
  if (!drum) return { ok: false, message: "Drum not found" };
  if (drum.unloadedAt) return { ok: false, message: "This drum already has an unload time" };
  // Only the time is asked for, so it always falls on the drum's unload date.
  const at = parseIstInput(`${drum.unloadDate.toISOString().slice(0, 10)}T${String(fd.get("time") ?? "")}`);
  if (!at) return { ok: false, message: "Enter the unload time" };
  if (at.getTime() > Date.now() + SKEW_MS) return { ok: false, message: "Unload time is in the future" };

  await prisma.drum.update({ where: { id: drum.id }, data: { unloadedAt: at, unloadTimeSource: "MANUAL", updatedBy: user.email } });
  await audit(
    "drums",
    drum.id,
    "UPDATE",
    { unloadedAt: { old: null, new: at }, unloadTimeSource: { old: drum.unloadTimeSource, new: "MANUAL" } },
    user.email,
  );
  await runRules(user.email);
  revalidatePath("/unload");
  return { ok: true, message: "Saved" };
}

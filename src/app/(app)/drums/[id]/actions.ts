"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runRules } from "@/lib/rules";
import type { ActionState } from "@/components/ui/client";

const DENIED: ActionState = { ok: false, message: "You don't have permission to do this." };

async function finish(email: string, message: string): Promise<ActionState> {
  let note = "";
  try {
    await runRules(email);
  } catch {
    // The change itself is saved; say so rather than show an error for it.
    note = " The status will refresh at the next hourly check.";
  }
  revalidatePath("/", "layout");
  return { ok: true, message: message + note };
}

/** Link an unlinked curing row with the same drum no to this drum (guide 6.3). */
export async function linkCuringRow(drumId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const logId = fd.get("logId");
  if (typeof logId !== "string" || !logId) return { ok: false, message: "Choose a curing row to link." };

  const drum = await prisma.drum.findUnique({ where: { id: drumId }, include: { curingLogs: { select: { cycleNo: true } } } });
  if (!drum) return { ok: false, message: "This drum was not found." };
  if (!can(user, drum.status === "DATA_ERROR" ? "resolveDataError" : "curingEntry")) return DENIED;
  if (!drum.isCuringItem) return { ok: false, message: "This drum is marked as not a curing item." };

  const log = await prisma.curingLog.findUnique({ where: { id: logId } });
  if (!log || log.coreDrumNo.trim().toLowerCase() !== drum.drumNo.trim().toLowerCase()) {
    return { ok: false, message: "That curing row is for a different drum no." };
  }
  const cycleNo = Math.max(0, ...drum.curingLogs.map((l) => l.cycleNo)) + 1;
  try {
    // `drumId: null` in the where: a row someone else linked a moment ago is refused, not stolen.
    const { count } = await prisma.curingLog.updateMany({
      where: { id: logId, drumId: null },
      data: { drumId, matchMethod: "MANUAL", matchedAt: new Date(), cycleNo, updatedBy: user.email },
    });
    if (!count) return { ok: false, message: "That curing row is already linked to another drum." };
    await audit(
      "curing_logs",
      logId,
      "UPDATE",
      { drumId: { old: null, new: drumId }, matchMethod: { old: log.matchMethod, new: "MANUAL" }, cycleNo: { old: log.cycleNo, new: cycleNo } },
      user.email,
    );
  } catch {
    return { ok: false, message: "Could not link the curing row. Please try again." };
  }
  return finish(user.email, "Curing row linked.");
}

/** Mark a drum as not a curing item, or undo that. */
export async function setCuringItem(drumId: string, isCuringItem: boolean): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "masters")) return DENIED;
  const drum = await prisma.drum.findUnique({ where: { id: drumId } });
  if (!drum) return { ok: false, message: "This drum was not found." };
  try {
    await prisma.drum.update({ where: { id: drumId }, data: { isCuringItem, updatedBy: user.email } });
    await audit("drums", drumId, "UPDATE", { isCuringItem: { old: drum.isCuringItem, new: isCuringItem } }, user.email);
  } catch {
    return { ok: false, message: "Could not save. Please try again." };
  }
  return finish(user.email, isCuringItem ? "Drum is back in the curing lists." : "Drum marked as not a curing item.");
}

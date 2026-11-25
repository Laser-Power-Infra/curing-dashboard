"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { DelayReason } from "@/generated/prisma/enums";
import type { ActionState } from "@/components/ui/client";
import { REASONS, TRACKER_FIELDS, mayEditTracker, type TrackerField } from "@/lib/tracker";

/** Inline auto-save of a MANUAL tracker column (Reason, Remarks, MD Remarks). */
export async function saveTrackerField(id: string, field: TrackerField, value: string): Promise<ActionState> {
  const user = await requireUser();
  if (typeof id !== "string" || typeof value !== "string" || !TRACKER_FIELDS.includes(field)) {
    return { ok: false, message: "Not saved: this change could not be read." };
  }
  const row = await prisma.missingDrumTracker.findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Not saved: this tracker row was not found." };
  if (!mayEditTracker(user, field, row.closedAt != null)) {
    return { ok: false, message: row.closedAt ? "Not saved: a closed row can be changed only by the production head or admin." : "Not saved: you don't have permission to change this." };
  }

  const next = value.trim() || null;
  if (field === "reason" && next && !(next in REASONS)) return { ok: false, message: "Not saved: choose a reason from the list." };
  if (field !== "reason" && next && next.length > 500) return { ok: false, message: "Not saved: keep it under 500 characters." };

  const data = field === "reason" ? { reason: next as DelayReason | null } : field === "remarks" ? { remarks: next } : { mdRemarks: next };
  try {
    await prisma.missingDrumTracker.update({ where: { id }, data: { ...data, manualUpdatedBy: user.email, manualUpdatedAt: new Date() } });
    await audit("missing_drum_tracker", id, "UPDATE", { [field]: { old: row[field], new: next } }, user.email);
  } catch {
    return { ok: false, message: "Not saved. Please try again." };
  }
  revalidatePath("/tracker");
  revalidatePath(`/drums/${row.drumId}`);
  return { ok: true, message: "Saved" };
}

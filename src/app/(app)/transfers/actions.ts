"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { istDay } from "@/lib/format";
import type { ActionState } from "@/components/ui/client";
import { Fail, isUniqueClash, refreshStatuses, run, str } from "../settings/run";

// A drum may go on a requisition only while all of this holds (guide 5.6). Used in the update's
// `where` too, so a drum that failed or was taken a moment ago cannot slip through.
const SENDABLE = { testResult: "PASS", sentDate: null, requisitionId: null } as const;

export async function raiseRequisition(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("transfer", async (user) => {
    const ids = [...new Set(fd.getAll("ids").map(String))];
    if (!ids.length) throw new Fail("Tick at least one drum first.");
    const prefix = `REQ-${istDay(new Date()).toISOString().slice(0, 10).replaceAll("-", "")}-`;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const reqNo = await prisma.$transaction(async (tx) => {
          const rows = await tx.curingLog.findMany({ where: { id: { in: ids }, ...SENDABLE }, include: { drum: { select: { lengthM: true } } } });
          const stale = () => new Fail("Some of the ticked drums can no longer be sent (failed, already sent or already on a requisition). Nothing was raised – refresh the page and tick again.");
          if (rows.length !== ids.length) throw stale();
          const n = (await tx.requisition.count({ where: { reqNo: { startsWith: prefix } } })) + 1 + attempt;
          const req = await tx.requisition.create({
            data: {
              reqNo: prefix + String(n).padStart(2, "0"),
              raisedBy: user.email,
              updatedBy: user.email,
              totalLengthM: rows.reduce((sum, r) => sum + Number(r.lengthM ?? r.drum?.lengthM ?? 0), 0),
            },
          });
          const linked = await tx.curingLog.updateMany({ where: { id: { in: ids }, ...SENDABLE }, data: { requisitionId: req.id, updatedBy: user.email } });
          if (linked.count !== ids.length) throw stale();
          await audit("requisitions", req.id, "CREATE", null, user.email, "UI", tx);
          for (const id of ids) await audit("curing_logs", id, "UPDATE", { requisitionId: { old: null, new: req.id } }, user.email, "UI", tx);
          return req.reqNo;
        });
        const note = await refreshStatuses(user.email);
        revalidatePath("/transfers");
        return `Requisition ${reqNo} raised for ${ids.length} drum${ids.length === 1 ? "" : "s"}.${note}`;
      } catch (e) {
        if (!isUniqueClash(e)) throw e; // someone took this number a moment ago: try the next one
      }
    }
    throw new Fail("Could not get a free requisition number. Please try again.");
  });
}

export async function markDispatched(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("transfer", async (user) => {
    const id = str(fd, "id");
    const now = new Date();
    const reqNo = await prisma.$transaction(async (tx) => {
      const req = await tx.requisition.findUnique({ where: { id }, include: { curingLogs: true } });
      if (!req || req.status !== "RAISED") throw new Fail("This requisition is no longer open.");
      if (!req.curingLogs.length) throw new Fail("This requisition has no drums on it.");
      const held = req.curingLogs.filter((l) => l.testResult !== "PASS");
      if (held.length) throw new Fail(`Drum ${held.map((l) => l.coreDrumNo).join(", ")} no longer has a Pass result and cannot be sent. Cancel this requisition and raise a new one.`);
      const done = await tx.requisition.updateMany({ where: { id, status: "RAISED" }, data: { status: "DISPATCHED", dispatchedAt: now, updatedBy: user.email } });
      if (done.count !== 1) throw new Fail("This requisition is no longer open.");
      await tx.curingLog.updateMany({ where: { requisitionId: id }, data: { sentDate: now, updatedBy: user.email } });
      await audit("requisitions", id, "UPDATE", { status: { old: "RAISED", new: "DISPATCHED" }, dispatchedAt: { old: null, new: now } }, user.email, "UI", tx);
      for (const l of req.curingLogs) await audit("curing_logs", l.id, "UPDATE", { sentDate: { old: l.sentDate, new: now } }, user.email, "UI", tx);
      return req.reqNo;
    });
    const note = await refreshStatuses(user.email);
    revalidatePath("/transfers");
    return `${reqNo} marked dispatched.${note}`;
  });
}

export async function cancelRequisition(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("transfer", async (user) => {
    const id = str(fd, "id");
    const reqNo = await prisma.$transaction(async (tx) => {
      const req = await tx.requisition.findUnique({ where: { id }, include: { curingLogs: { select: { id: true } } } });
      const done = await tx.requisition.updateMany({ where: { id, status: "RAISED" }, data: { status: "CANCELLED", updatedBy: user.email } });
      if (!req || done.count !== 1) throw new Fail("This requisition is no longer open.");
      await tx.curingLog.updateMany({ where: { requisitionId: id }, data: { requisitionId: null, updatedBy: user.email } });
      await audit("requisitions", id, "CLOSE", { status: { old: "RAISED", new: "CANCELLED" } }, user.email, "UI", tx);
      for (const l of req.curingLogs) await audit("curing_logs", l.id, "UPDATE", { requisitionId: { old: id, new: null } }, user.email, "UI", tx);
      return req.reqNo;
    });
    const note = await refreshStatuses(user.email);
    revalidatePath("/transfers");
    return `${reqNo} cancelled. Its drums are back in the ready list.${note}`;
  });
}

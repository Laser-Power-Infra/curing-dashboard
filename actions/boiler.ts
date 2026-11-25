"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseDateOnly } from "@/lib/format";
import type { ActionState } from "@/components/ui/client";
import { Fail, diff, num, run, str } from "./run";
import { shiftWindow } from "@/lib/shifts";

export async function saveReading(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("boilerEntry", async (user) => {
    const date = parseDateOnly(str(fd, "date"));
    if (!date) throw new Fail("Choose the date.");
    const [shift, boiler] = await Promise.all([
      prisma.shiftDef.findFirst({ where: { id: str(fd, "shiftId"), active: true } }),
      prisma.boiler.findFirst({ where: { id: str(fd, "boilerId"), active: true } }),
    ]);
    if (!shift) throw new Fail("Choose the shift.");
    if (!boiler) throw new Fail("Choose the boiler.");
    if (shiftWindow(date, shift).start > new Date()) throw new Fail("This shift has not started yet.");

    // Decimal(6,2) columns: the upper limits only stop typing slips, they are not process limits.
    const data = {
      temperatureC: str(fd, "temperatureC") ? num(fd, "temperatureC", "Temperature", 0, 999) : null,
      pressureBar: str(fd, "pressureBar") ? num(fd, "pressureBar", "Pressure", 0, 999) : null,
      remarks: str(fd, "remarks") || null,
    };
    if (data.temperatureC == null && data.pressureBar == null) throw new Fail("Enter the temperature or the pressure.");

    const key = { boilerId_date_shiftId: { boilerId: boiler.id, date, shiftId: shift.id } };
    const old = await prisma.boilerReading.findUnique({ where: key });
    const stamp = { recordedAt: new Date(), recordedBy: user.email };
    const row = await prisma.boilerReading.upsert({
      where: key,
      update: { ...data, ...stamp },
      create: { boilerId: boiler.id, date, shiftId: shift.id, ...data, ...stamp },
    });
    await audit(
      "boiler_readings",
      row.id,
      old ? "UPDATE" : "CREATE",
      old && diff({ temperatureC: old.temperatureC && Number(old.temperatureC), pressureBar: old.pressureBar && Number(old.pressureBar), remarks: old.remarks }, data),
      user.email,
    );
    revalidatePath("/boiler");
    return old ? `Reading for ${boiler.name}, ${shift.name} shift updated.` : `Reading for ${boiler.name}, ${shift.name} shift saved.`;
  });
}

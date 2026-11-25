"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseIstInput } from "@/lib/format";
import { Prisma } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import type { ActionState } from "@/components/ui/client";
import { Fail, diff, num, run, str } from "./run";

const done = (message: string) => {
  revalidatePath("/settings");
  return message;
};
const PHONE = /^\+\d{10,15}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const on = (fd: FormData, key: string) => fd.get(key) === "on";

// --- Settings (key–value) -----------------------------------------------------------------------
async function writeSettings(values: Record<string, Prisma.InputJsonValue | null>, by: string) {
  const old = new Map((await prisma.setting.findMany({ where: { key: { in: Object.keys(values) } } })).map((r) => [r.key, r.value]));
  for (const [key, value] of Object.entries(values)) {
    if (JSON.stringify(old.get(key) ?? null) === JSON.stringify(value)) continue;
    const json = value === null ? Prisma.JsonNull : value;
    await prisma.setting.upsert({ where: { key }, update: { value: json, updatedBy: by }, create: { key, value: json, updatedBy: by } });
    await audit("settings", key, "UPDATE", { value: { old: old.get(key), new: value } }, by);
  }
}

export async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("settings", async (user) => {
    const hours = (key: string, label: string) => num(fd, key, label, 0.25, 720);
    const buckets = str(fd, "ui.ageingBucketsHours").split(/[\s,]+/).filter(Boolean).map(Number);
    if (!buckets.length || buckets.length > 6 || buckets.some((b, i) => !(b > 0) || (i > 0 && b <= buckets[i - 1])))
      throw new Fail("Ageing buckets must be 1 to 6 rising numbers of hours, for example 24, 48, 72.");
    const numbers = [...new Set(str(fd, "alerts.testNumbers").split(/[\s,;]+/).filter(Boolean))];
    const bad = numbers.find((n) => !PHONE.test(n));
    if (bad) throw new Fail(`Test number "${bad}" is not valid. Write it with + and the country code, for example +917001275745.`);
    const fromText = str(fd, "alerts.enabledFrom");
    const from = parseIstInput(fromText);
    if (fromText && !from) throw new Fail("Alerts start date is not a valid date and time.");
    const attempts = num(fd, "alerts.maxSendAttempts", "Send attempts", 1, 10);
    if (!Number.isInteger(attempts)) throw new Fail("Send attempts must be a whole number.");

    await writeSettings(
      {
        "rules.curingStartLimitHours": hours("rules.curingStartLimitHours", "Curing start limit"),
        "rules.testOverdueGraceHours": hours("rules.testOverdueGraceHours", "Test overdue grace"),
        "rules.curingLogSilenceHours": hours("rules.curingLogSilenceHours", "Curing log silence"),
        "rules.lineRunningWindowHours": hours("rules.lineRunningWindowHours", "Line running window"),
        "data.staleFeedHours": hours("data.staleFeedHours", "Drum feed age"),
        "alerts.maxSendAttempts": attempts,
        "alerts.enabledFrom": from ? from.toISOString() : null,
        "alerts.testNumbers": numbers,
        "ui.ageingBucketsHours": buckets,
      },
      user.email,
    );
    revalidatePath("/", "layout");
    return "Settings saved.";
  });
}

export async function setTestMode(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("settings", async (user) => {
    const turnOn = str(fd, "mode") !== "off";
    // Guide 12.6: live WhatsApp alerts only after the MD has seen the test results and approved.
    if (!turnOn && !on(fd, "mdApproved")) throw new Fail("Test mode stays ON. Tick the box to confirm the MD has approved live alerts.");
    await writeSettings({ "alerts.testMode": turnOn }, user.email);
    revalidatePath("/", "layout");
    return turnOn ? "Test mode is ON. Alerts go only to the test numbers." : "Test mode is OFF. Alerts now go to plant staff and the MD.";
  });
}

export async function saveShift(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("settings", async (user) => {
    const old = await prisma.shiftDef.findUnique({ where: { id: str(fd, "id") } });
    if (!old) throw new Fail("Shift not found.");
    const data = { startTime: str(fd, "startTime"), endTime: str(fd, "endTime"), confirmed: on(fd, "confirmed") };
    if (![data.startTime, data.endTime].every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Fail("Enter both times as HH:mm, for example 06:00.");
    if (data.startTime === data.endTime) throw new Fail("Start and end time cannot be the same.");
    await prisma.shiftDef.update({ where: { id: old.id }, data });
    await audit("shift_defs", old.id, "UPDATE", diff(old, data), user.email);
    revalidatePath("/boiler");
    return done(`${old.name} shift saved.`);
  });
}

export async function saveEscalationRule(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("settings", async (user) => {
    const old = await prisma.escalationRule.findUnique({ where: { id: str(fd, "id") }, include: { recipients: true } });
    if (!old) throw new Fail("Escalation level not found.");
    const recipients = await prisma.person.findMany({ where: { id: { in: fd.getAll("recipients").map(String) } }, orderBy: { name: "asc" } });
    const data = {
      delayMinutes: Math.round(num(fd, "delayHours", "Delay", 0, 720) * 60),
      description: str(fd, "description"),
      active: on(fd, "active"),
    };
    if (!data.description) throw new Fail("Write a short description, for example \"8 h after unload → Mukesh\".");
    if (data.active && !recipients.length) throw new Fail("Tick at least one person, or switch this level off.");
    await prisma.escalationRule.update({ where: { id: old.id }, data: { ...data, updatedBy: user.email, recipients: { set: recipients.map((p) => ({ id: p.id })) } } });
    const names = (ps: { name: string }[]) => ps.map((p) => p.name).sort();
    await audit("escalation_rules", old.id, "UPDATE", { ...diff(old, data), recipients: { old: names(old.recipients), new: names(recipients) } }, user.email);
    revalidatePath("/help");
    return done("Escalation level saved.");
  });
}

// --- People and users ---------------------------------------------------------------------------
export async function savePerson(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("masters", async (user) => {
    const id = str(fd, "id");
    const data = { name: str(fd, "name"), role: str(fd, "role") || null, whatsapp: str(fd, "whatsapp") || null, email: str(fd, "email").toLowerCase() || null, active: on(fd, "active") };
    if (!data.name) throw new Fail("Enter the name.");
    if (data.whatsapp && !PHONE.test(data.whatsapp)) throw new Fail("WhatsApp number must start with + and the country code, then 10 to 15 digits, for example +917001275745.");
    if (data.email && !EMAIL.test(data.email)) throw new Fail("Email is not valid.");
    if (!id) {
      const row = await prisma.person.create({ data: { ...data, active: true, createdBy: user.email } });
      await audit("persons", row.id, "CREATE", null, user.email);
      return done(`${data.name} added.`);
    }
    const old = await prisma.person.findUnique({ where: { id } });
    if (!old) throw new Fail("Person not found.");
    await prisma.person.update({ where: { id }, data: { ...data, updatedBy: user.email } });
    await audit("persons", id, "UPDATE", diff(old, data), user.email);
    return done(`${data.name} saved.`);
  });
}

export async function saveUser(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("settings", async (user) => {
    const id = str(fd, "id");
    const roles = Object.values(Role).filter((r) => fd.getAll("roles").includes(r));
    const data = { name: str(fd, "name") || null, roles, active: on(fd, "active") };
    if (!id) {
      const email = str(fd, "email").toLowerCase();
      if (!EMAIL.test(email)) throw new Fail("Enter the user's company email.");
      const row = await prisma.user.create({ data: { email, ...data, active: true } });
      await audit("users", row.id, "CREATE", null, user.email);
      return done(`${email} added.`);
    }
    const old = await prisma.user.findUnique({ where: { id } });
    if (!old) throw new Fail("User not found.");
    const wasAdmin = old.active && old.roles.includes("ADMIN");
    const staysAdmin = data.active && roles.includes("ADMIN");
    if (wasAdmin && !staysAdmin && !(await prisma.user.count({ where: { id: { not: id }, active: true, roles: { has: "ADMIN" } } })))
      throw new Fail("This is the last active Admin. Make another user Admin first.");
    await prisma.user.update({ where: { id }, data });
    await audit("users", id, "UPDATE", diff(old, data), user.email);
    return done(`${old.email} saved.`);
  });
}

// --- Recipes (guide 3.5) --------------------------------------------------------------------------
export async function saveRecipe(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("masters", async (user) => {
    const id = str(fd, "id");
    const data = {
      compound: str(fd, "compound"),
      productId: str(fd, "productId"),
      curingType: str(fd, "curingType"),
      approvedCuringHrs: num(fd, "approvedCuringHrs", "Approved curing hours", 0.25, 999),
      waitBeforeTestHrs: num(fd, "waitBeforeTestHrs", "Wait before test", 0, 999),
      remarks: str(fd, "remarks") || null,
    };
    if (!data.compound || !data.curingType) throw new Fail("Enter the compound and the curing type.");
    if (!(await prisma.product.findUnique({ where: { id: data.productId } }))) throw new Fail("Choose the product.");
    if (!id) {
      const row = await prisma.curingRecipe.create({ data: { ...data, status: "DRAFT", createdBy: user.email } });
      await audit("curing_recipes", row.id, "CREATE", null, user.email);
      return done("Draft recipe added. The production head must approve it before the rules use it.");
    }
    const old = await prisma.curingRecipe.findUnique({ where: { id } });
    if (!old) throw new Fail("Recipe not found.");
    const before = { ...old, approvedCuringHrs: Number(old.approvedCuringHrs), waitBeforeTestHrs: Number(old.waitBeforeTestHrs) };
    // An approval covers exactly what was approved: change any of it and it needs approval again.
    const changed = (["compound", "productId", "curingType", "approvedCuringHrs", "waitBeforeTestHrs"] as const).some((k) => before[k] !== data[k]);
    const next = old.status === "APPROVED" && changed ? { ...data, status: "DRAFT" as const, approvedBy: null, approvedAt: null } : data;
    await prisma.curingRecipe.update({ where: { id }, data: { ...next, updatedBy: user.email } });
    await audit("curing_recipes", id, "UPDATE", diff(before, next), user.email);
    return done("status" in next ? "Recipe saved and put back to Draft. It needs approval again before the rules use it." : "Recipe saved.");
  });
}

/** Two approved, in-use recipes for one compound + product would make the curing hours a coin toss. */
async function clashingRecipe(r: { id: string; compound: string; productId: string }) {
  return prisma.curingRecipe.findFirst({ where: { id: { not: r.id }, productId: r.productId, compound: { equals: r.compound, mode: "insensitive" }, status: "APPROVED", inUse: true } });
}
const CLASH = "Another approved recipe is already in use for this compound and product. Retire it or take it out of use first.";

export async function approveRecipe(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("approveRecipe", async (user) => {
    const old = await prisma.curingRecipe.findUnique({ where: { id: str(fd, "id") } });
    if (!old || old.status !== "DRAFT") throw new Fail("Only a Draft recipe can be approved.");
    if (old.inUse && (await clashingRecipe(old))) throw new Fail(CLASH);
    const data = { status: "APPROVED" as const, approvedBy: user.email, approvedAt: new Date() };
    await prisma.curingRecipe.update({ where: { id: old.id }, data: { ...data, updatedBy: user.email } });
    await audit("curing_recipes", old.id, "UPDATE", diff(old, data), user.email);
    return done("Recipe approved.");
  });
}

export async function setRecipeState(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("masters", async (user) => {
    const old = await prisma.curingRecipe.findUnique({ where: { id: str(fd, "id") } });
    if (!old) throw new Fail("Recipe not found.");
    const what = str(fd, "what");
    if (what === "retire") {
      if (old.status === "RETIRED") throw new Fail("This recipe is already retired.");
      await prisma.curingRecipe.update({ where: { id: old.id }, data: { status: "RETIRED", updatedBy: user.email } });
      await audit("curing_recipes", old.id, "CLOSE", { status: { old: old.status, new: "RETIRED" } }, user.email);
      return done("Recipe retired.");
    }
    const inUse = what === "use";
    if (inUse && old.status === "APPROVED" && (await clashingRecipe(old))) throw new Fail(CLASH);
    await prisma.curingRecipe.update({ where: { id: old.id }, data: { inUse, updatedBy: user.email } });
    await audit("curing_recipes", old.id, "UPDATE", { inUse: { old: old.inUse, new: inUse } }, user.email);
    return done(inUse ? "Recipe is in use." : "Recipe taken out of use.");
  });
}

// --- Tanks / autoclaves and boilers ---------------------------------------------------------------
export async function saveUnit(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("masters", async (user) => {
    const id = str(fd, "id");
    const kind = str(fd, "kind"); // TANK | AUTOCLAVE | BOILER
    if (kind !== "TANK" && kind !== "AUTOCLAVE" && kind !== "BOILER") throw new Fail("Choose tank, autoclave or boiler.");
    const table = kind === "BOILER" ? "boilers" : "curing_units";
    const data = { name: str(fd, "name"), active: on(fd, "active") };
    if (!data.name) throw new Fail("Enter the name.");
    if (!id) {
      const code = str(fd, "code").toUpperCase();
      if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw new Fail("Code must be 2 to 20 letters or digits, for example UBL07.");
      const row = kind === "BOILER" ? await prisma.boiler.create({ data: { code, ...data, active: true } }) : await prisma.curingUnit.create({ data: { code, type: kind, ...data, active: true } });
      await audit(table, row.id, "CREATE", null, user.email);
      return done(`${data.name} added.`);
    }
    const old = kind === "BOILER" ? await prisma.boiler.findUnique({ where: { id } }) : await prisma.curingUnit.findUnique({ where: { id } });
    if (!old) throw new Fail("Not found.");
    if (kind === "BOILER") await prisma.boiler.update({ where: { id }, data });
    else await prisma.curingUnit.update({ where: { id }, data });
    await audit(table, id, "UPDATE", diff(old, data), user.email);
    revalidatePath("/boiler");
    return done(`${data.name} saved.`);
  });
}

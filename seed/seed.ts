/**
 * Curing Dashboard – database seed
 *
 * Seeds master and configuration data only (no transactions):
 *   plants, lines, shifts, boilers, curing units, persons, responsibilities,
 *   escalation matrix, settings, products. Users sign up themselves; roles are set in the users table.
 *
 * Safe to run many times: every write is an upsert on a natural key.
 * Run:  npx prisma db seed      (after `npx prisma migrate dev`)
 *
 * NOT seeded on purpose – import from the Curing Sheet instead (guide 4.3):
 *   Curing Recipe Master, Curing Log, Hot Set Test, Boiler Temp Log, Daily History, drums.
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import {
  Prisma,
  PrismaClient,
  type AlertTrigger,
  type EscalationAnchor,
  type ResponsibilityArea,
} from "../generated/prisma/client";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DIRECT_URL (or DATABASE_URL) in .env");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const SEEDED_BY = "seed";

// ---------------------------------------------------------------------------
// 1. Plants and lines
// ---------------------------------------------------------------------------
const plants = [
  { code: "KGP", name: "Kharagpur" },
  { code: "PPK", name: "Polypark" },
];

// Phase 1 scope = Kharagpur Sioplas 3 & 4 only. Sioplas 1 & 2 are Polypark lines (later phase).
const lines = [
  { code: "SIOPLAS_3", name: "Sioplas 3", plant: "KGP", erpCode: null, inScope: true },
  { code: "SIOPLAS_4", name: "Sioplas 4", plant: "KGP", erpCode: "EX075", inScope: true },
  { code: "SIOPLAS_1", name: "Sioplas 1", plant: "PPK", erpCode: null, inScope: false },
  { code: "SIOPLAS_2", name: "Sioplas 2", plant: "PPK", erpCode: null, inScope: false },
];

// ---------------------------------------------------------------------------
// 2. Shifts – PLACEHOLDER timings, plant to confirm (guide D6 / open point 4)
// ---------------------------------------------------------------------------
const shifts = [
  { code: "MORNING", name: "Morning", startTime: "06:00", endTime: "14:00", sortOrder: 1 },
  { code: "AFTERNOON", name: "Afternoon", startTime: "14:00", endTime: "22:00", sortOrder: 2 },
  { code: "NIGHT", name: "Night", startTime: "22:00", endTime: "06:00", sortOrder: 3 },
];

// ---------------------------------------------------------------------------
// 3. Boilers and curing units (from Men per shift / Machine routing)
//    Add the real tank names on the Masters page.
// ---------------------------------------------------------------------------
const boilers = [
  { code: "UBL06", name: "Boiler 6" },
  { code: "UBL07", name: "Boiler 7" },
];
const curingUnits = [{ code: "ACL01", name: "Autoclave No 01", type: "AUTOCLAVE" as const }];

// ---------------------------------------------------------------------------
// 4. Persons and responsibilities (handover doc, section 3)
//    MD and Prasenjit numbers to be added (open point 5).
// ---------------------------------------------------------------------------
const persons = [
  { key: "KUNTAL", name: "Kuntal Khanra", role: "Curing – loading / unloading", whatsapp: "+917001275745" },
  { key: "SUVAJIT", name: "Suvajit Kar", role: "Hot Set Test", whatsapp: "+918317833974" },
  { key: "PRAVATRANJAN", name: "Pravatranjan Pal", role: "Boiler Temp Log", whatsapp: "+918768444213" },
  { key: "MUKESH", name: "Mukesh", role: "Production head", whatsapp: "+918252976559" },
  { key: "KAMLESH", name: "Kamlesh", role: "Product Master / planning", whatsapp: "+918961401145" },
  { key: "PRASENJIT", name: "Prasenjit", role: "Transfer – requisition to Polypark", whatsapp: null },
  { key: "MD", name: "Deepak Goel", role: "MD", whatsapp: null },
] as const;
type PersonKey = (typeof persons)[number]["key"];

const responsibilities: { area: ResponsibilityArea; person: PersonKey; isPrimary?: boolean }[] = [
  { area: "CURING_LOG", person: "KUNTAL" },
  { area: "HOT_SET_TEST", person: "SUVAJIT" },
  { area: "BOILER_LOG", person: "PRAVATRANJAN" },
  { area: "RECIPE_MASTER", person: "MUKESH" },
  { area: "PERSON_MASTER", person: "MUKESH" },
  { area: "PRODUCTION_HEAD", person: "MUKESH" },
  { area: "PRODUCT_MASTER", person: "KAMLESH" },
  { area: "TRANSFER", person: "PRASENJIT" },
  { area: "TRANSFER", person: "MUKESH", isPrimary: false },
  { area: "TRANSFER", person: "KAMLESH", isPrimary: false },
  { area: "TRANSFER", person: "KUNTAL", isPrimary: false },
  { area: "MD", person: "MD" },
];

// ---------------------------------------------------------------------------
// 5. Escalation matrix – confirmed by MD on 23-Nov-26 (guide 9.1)
// ---------------------------------------------------------------------------
const H = 60; // minutes per hour
const escalationRules: {
  trigger: AlertTrigger;
  level: number;
  anchor: EscalationAnchor;
  delayMinutes: number;
  to: PersonKey[];
  description: string;
}[] = [
  // Drum not in curing – counted from unload
  { trigger: "DRUM_NOT_IN_CURING", level: 1, anchor: "FROM_UNLOAD", delayMinutes: 6 * H, to: ["KUNTAL"], description: "6 h after unload → Kuntal Khanra" },
  { trigger: "DRUM_NOT_IN_CURING", level: 2, anchor: "FROM_UNLOAD", delayMinutes: 8 * H, to: ["MUKESH"], description: "8 h after unload → Mukesh" },
  { trigger: "DRUM_NOT_IN_CURING", level: 3, anchor: "FROM_UNLOAD", delayMinutes: 12 * H, to: ["KAMLESH", "MD"], description: "12 h after unload → Kamlesh + MD" },

  // Curing Log not updated – line running, no new curing row
  { trigger: "CURING_LOG_NOT_UPDATED", level: 1, anchor: "FROM_LAST_CURING_ENTRY", delayMinutes: 4 * H, to: ["KUNTAL"], description: "4 h without a curing entry → Kuntal Khanra" },
  { trigger: "CURING_LOG_NOT_UPDATED", level: 2, anchor: "FROM_LAST_CURING_ENTRY", delayMinutes: 6 * H, to: ["MUKESH"], description: "6 h without a curing entry → Mukesh" },

  // Under-cured drum
  { trigger: "UNDER_CURED", level: 1, anchor: "FROM_EVENT", delayMinutes: 0, to: ["KUNTAL", "MUKESH"], description: "Immediately → Kuntal + Mukesh" },
  { trigger: "UNDER_CURED", level: 2, anchor: "FROM_EVENT", delayMinutes: 24 * H, to: ["MD"], description: "Next day still open → MD" },

  // Test overdue – counted from test due
  { trigger: "TEST_OVERDUE", level: 1, anchor: "FROM_TEST_DUE", delayMinutes: 2 * H, to: ["SUVAJIT"], description: "Test due + 2 h → Suvajit Kar" },
  { trigger: "TEST_OVERDUE", level: 2, anchor: "FROM_TEST_DUE", delayMinutes: 6 * H, to: ["MUKESH"], description: "Test due + 6 h → Mukesh" },
  { trigger: "TEST_OVERDUE", level: 3, anchor: "FROM_TEST_DUE", delayMinutes: 24 * H, to: ["MD"], description: "Test due + 24 h → MD" },

  // Test failed
  { trigger: "TEST_FAILED", level: 1, anchor: "FROM_EVENT", delayMinutes: 0, to: ["MUKESH", "SUVAJIT"], description: "Immediately → Mukesh + Suvajit" },
  { trigger: "TEST_FAILED", level: 2, anchor: "FROM_EVENT", delayMinutes: 24 * H, to: ["MD"], description: "Not re-cured in 24 h → MD" },

  // Passed, requisition not raised
  { trigger: "PASSED_NO_REQUISITION", level: 1, anchor: "FROM_EVENT", delayMinutes: 0, to: ["PRASENJIT", "MUKESH", "KAMLESH", "KUNTAL"], description: "Immediately → Prasenjit, Mukesh, Kamlesh, Kuntal" },
  { trigger: "PASSED_NO_REQUISITION", level: 2, anchor: "FROM_EVENT", delayMinutes: 24 * H, to: ["MUKESH"], description: "+24 h → Mukesh" },
  { trigger: "PASSED_NO_REQUISITION", level: 3, anchor: "FROM_EVENT", delayMinutes: 48 * H, to: ["MD"], description: "+48 h → MD" },

  // Boiler reading missed – "next shift" assumes 8-hour shifts; adjust with shift timings
  { trigger: "BOILER_READING_MISSED", level: 1, anchor: "FROM_SHIFT_END", delayMinutes: 0, to: ["PRAVATRANJAN"], description: "Shift end → Pravatranjan Pal" },
  { trigger: "BOILER_READING_MISSED", level: 2, anchor: "FROM_SHIFT_END", delayMinutes: 8 * H, to: ["MUKESH"], description: "Next shift → Mukesh" },

  // Not in the MD matrix – proposed in the guide (rule 5.4)
  { trigger: "NO_RECIPE", level: 1, anchor: "FROM_EVENT", delayMinutes: 0, to: ["MUKESH"], description: "No approved recipe for a curing entry → Mukesh" },
];

// ---------------------------------------------------------------------------
// 6. Settings (guide 3.13) – all values editable in Settings
// ---------------------------------------------------------------------------
const settings: { key: string; value: unknown; description: string }[] = [
  { key: "timezone", value: "Asia/Kolkata", description: "Display time zone" },
  { key: "rules.curingStartLimitHours", value: 6, description: "Rule 1: curing must start within this many hours of unload" },
  { key: "rules.testOverdueGraceHours", value: 2, description: "Rule 5: no result this many hours after test due = Test overdue" },
  { key: "rules.curingLogSilenceHours", value: 4, description: "Rule 8: no new curing row for this many hours while a line runs" },
  { key: "rules.lineRunningWindowHours", value: 4, description: "Rule 8: line counts as running if a drum was unloaded in this window (proposed – Mukesh to confirm)" },
  { key: "data.staleFeedHours", value: 2, description: "Show the data health banner if the drum feed is older than this" },
  { key: "alerts.enabledFrom", value: null, description: "Only drums unloaded on/after this ISO date-time can create alerts. Set at go-live." },
  { key: "alerts.testMode", value: true, description: "true = alerts go only to alerts.testNumbers and are labelled [TEST]. MD approval needed to switch off." },
  { key: "alerts.testNumbers", value: [], description: "WhatsApp numbers (E.164) that receive alerts in test mode" },
  { key: "alerts.whatsappRoute", value: null, description: "SHEET or API – to be decided (open point 3)" },
  { key: "alerts.maxSendAttempts", value: 3, description: "Retries before an alert is marked FAILED" },
  { key: "jobs.mdSummaryTime", value: "08:15", description: "W7 Daily MD summary time (IST)" },
  { key: "jobs.dailyHistoryTime", value: "08:00", description: "W0 Daily History snapshot time (IST)" },
  { key: "ui.ageingBucketsHours", value: [24, 48, 72], description: "Ageing buckets for passed-not-sent and failed-not-re-cured" },
];

// ---------------------------------------------------------------------------
// 7. Products – core items seen on Sioplas 3/4 (Curing tab, 8-Oct to 16-Nov-26).
//    Codes, sizes and voltages to be completed by Kamlesh on the Product Master page.
// ---------------------------------------------------------------------------
const products: { name: string; sizeSqMm: number; voltageKv: number | null; isCuringItem: boolean }[] = [
  { name: "COVERED CONDUCTOR - 100 SQ. MM. (AAAC) - 11 KV (SIO/AL-7) (IS)", sizeSqMm: 100, voltageKv: 11, isCuringItem: true },
  { name: "100 SQ. MM. (AAAC) - 11KV COVERED CONDUCTOR (INSULATED) (TPWODL)", sizeSqMm: 100, voltageKv: 11, isCuringItem: true },
  { name: "300 SQ. MM. CORE INSULATED 11kv (TPNODL/GENERAL) (XLPE/SIO)", sizeSqMm: 300, voltageKv: 11, isCuringItem: true },
  { name: "300 SQ. MM. CORE INSULATED 11kv (XLPE/SIO - SBPDCL/GENERAL)", sizeSqMm: 300, voltageKv: 11, isCuringItem: true },
  { name: "300 SQ. MM. CORE INSULATED 11kv (SIO) (CESC) (IS)", sizeSqMm: 300, voltageKv: 11, isCuringItem: true },
  { name: "300 SQ. MM. CORE INSULATED 11kv (XLPE/SIOPLASS - SPECIAL)", sizeSqMm: 300, voltageKv: 11, isCuringItem: true },
  { name: "400 SQ. MM. CORE INSULATED 11kv (SIO) (TPSODL - GENERAL)", sizeSqMm: 400, voltageKv: 11, isCuringItem: true },
  { name: "630 SQ. MM. CORE INSULATED 11kv (GENERAL) (SIO)", sizeSqMm: 630, voltageKv: 11, isCuringItem: true },
  { name: "630 SQ. MM. CORE INSULATED 11kv (SIO) (IS)", sizeSqMm: 630, voltageKv: 11, isCuringItem: true },
  { name: "630 SQ. MM. CORE INSULATED 33kv (SIO) (TATA/GENERAL)", sizeSqMm: 630, voltageKv: 33, isCuringItem: true },
  // Conductor, not an insulated core – excluded from the curing rules (guide 4.2)
  { name: "630 SQ. MM. COMPACT CONDUCTOR - IS", sizeSqMm: 630, voltageKv: null, isCuringItem: false },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function main() {
  console.log("Seeding Curing Dashboard master data…");

  // Plants
  const plantIds: Record<string, string> = {};
  for (const p of plants) {
    const row = await prisma.plant.upsert({
      where: { code: p.code },
      update: { name: p.name },
      create: p,
    });
    plantIds[p.code] = row.id;
  }

  // Lines
  for (const l of lines) {
    const data = { name: l.name, erpCode: l.erpCode, inScope: l.inScope, plantId: plantIds[l.plant] };
    await prisma.line.upsert({ where: { code: l.code }, update: data, create: { code: l.code, ...data } });
  }

  // Shifts (confirmed = false until the plant confirms timings; don't overwrite once edited)
  for (const s of shifts) {
    await prisma.shiftDef.upsert({ where: { code: s.code }, update: {}, create: { ...s, confirmed: false } });
  }

  // Boilers and curing units
  for (const b of boilers) {
    await prisma.boiler.upsert({ where: { code: b.code }, update: { name: b.name }, create: b });
  }
  for (const u of curingUnits) {
    await prisma.curingUnit.upsert({ where: { code: u.code }, update: { name: u.name, type: u.type }, create: u });
  }

  // Persons – keep a number that was added later in the UI if the seed has none
  const personIds = {} as Record<PersonKey, string>;
  for (const p of persons) {
    const row = await prisma.person.upsert({
      where: { name: p.name },
      update: { role: p.role, ...(p.whatsapp ? { whatsapp: p.whatsapp } : {}), updatedBy: SEEDED_BY },
      create: { name: p.name, role: p.role, whatsapp: p.whatsapp, createdBy: SEEDED_BY },
    });
    personIds[p.key] = row.id;
  }

  // Responsibilities
  for (const r of responsibilities) {
    const personId = personIds[r.person];
    await prisma.responsibility.upsert({
      where: { area_personId: { area: r.area, personId } },
      update: { isPrimary: r.isPrimary ?? true, active: true },
      create: { area: r.area, personId, isPrimary: r.isPrimary ?? true },
    });
  }

  // Escalation matrix
  for (const e of escalationRules) {
    const recipients = e.to.map((k) => ({ id: personIds[k] }));
    await prisma.escalationRule.upsert({
      where: { trigger_level: { trigger: e.trigger, level: e.level } },
      update: {
        anchor: e.anchor,
        delayMinutes: e.delayMinutes,
        description: e.description,
        recipients: { set: recipients },
        updatedBy: SEEDED_BY,
      },
      create: {
        trigger: e.trigger,
        level: e.level,
        anchor: e.anchor,
        delayMinutes: e.delayMinutes,
        description: e.description,
        recipients: { connect: recipients },
        updatedBy: SEEDED_BY,
      },
    });
  }

  // Settings – create only; never overwrite values changed in the UI
  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { description: s.description },
      create: {
        key: s.key,
        value: s.value === null ? Prisma.JsonNull : (s.value as Prisma.InputJsonValue),
        description: s.description,
        updatedBy: SEEDED_BY,
      },
    });
  }

  // Products
  for (const p of products) {
    await prisma.product.upsert({
      where: { name: p.name },
      update: { isCuringItem: p.isCuringItem, updatedBy: SEEDED_BY },
      create: { ...p, createdBy: SEEDED_BY },
    });
  }

  const counts = {
    plants: await prisma.plant.count(),
    lines: await prisma.line.count(),
    shifts: await prisma.shiftDef.count(),
    boilers: await prisma.boiler.count(),
    curingUnits: await prisma.curingUnit.count(),
    persons: await prisma.person.count(),
    responsibilities: await prisma.responsibility.count(),
    escalationRules: await prisma.escalationRule.count(),
    settings: await prisma.setting.count(),
    products: await prisma.product.count(),
    users: await prisma.user.count(),
  };
  console.table(counts);
  console.log("Done. Next: import the Curing Recipe Master and history from the Curing Sheet (guide 4.3).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// Alerts & Escalations – read-only (guide 6.8, 3.9, 3.10).
import { prisma } from "@/lib/prisma";
import { isStaff, viewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fmtDateTime, istDayStart, parseDateOnly } from "@/lib/format";
import { Banner, Button, Card, Chip, EmptyState, Field, Input, LinkButton, PageHeader, Select, Table, type Tone } from "@/components/ui";
import type { AlertStatus, AlertTrigger } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { PAGE_SIZE, pageOf } from "@/lib/table";
import { TRIGGER_LABEL } from "@/lib/alert-labels";

// Not the shared StatusChip: there "FAILED" means a failed hot set, here it means a message that did not go out.
const DELIVERY: Record<AlertStatus, { label: string; tone: Tone }> = {
  SENT: { label: "Sent", tone: "green" },
  QUEUED: { label: "Queued", tone: "amber" },
  FAILED: { label: "Failed to send", tone: "red" },
  SKIPPED: { label: "Not sent – no number", tone: "amber" },
};

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = isStaff(await viewer()); // phone numbers are for staff only
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const now = new Date();

  const trigger = one("trigger") in TRIGGER_LABEL ? (one("trigger") as AlertTrigger) : undefined;
  const status = one("status") in DELIVERY ? (one("status") as AlertStatus) : undefined;
  const level = /^\d+$/.test(one("level")) ? Number(one("level")) : undefined;
  const from = parseDateOnly(one("from"));
  const to = parseDateOnly(one("to"));
  const page = pageOf(sp);
  const where: Prisma.AlertWhereInput = {
    trigger,
    status,
    level,
    personId: one("person") || undefined,
    queuedAt: { gte: from ? istDayStart(from) : undefined, lt: to ? new Date(istDayStart(to).getTime() + 86_400_000) : undefined },
  };

  const [settings, persons, total, alerts, rules, escalations] = await Promise.all([
    getSettings(),
    prisma.person.findMany({ orderBy: { name: "asc" } }),
    prisma.alert.count({ where }),
    prisma.alert.findMany({ where, include: { person: true }, orderBy: { queuedAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.escalationRule.findMany({ include: { recipients: true } }),
    // shortcut: the 300 longest-open escalations; add paging if more than that are ever open at once.
    prisma.escalation.findMany({ where: { resolvedAt: null, OR: [{ firedAt: { not: null } }, { dueAt: { lte: now } }] }, orderBy: { dueAt: "asc" }, take: 300 }),
  ]);

  // What each open escalation is about.
  const ids = (type: string) => escalations.filter((e) => e.objectType === type).map((e) => e.objectId);
  const [drums, logs, tests, lines, boilers, shifts] = await Promise.all([
    prisma.drum.findMany({ where: { id: { in: ids("DRUM") } }, select: { id: true, drumNo: true } }),
    prisma.curingLog.findMany({ where: { id: { in: ids("CURING_LOG") } }, select: { id: true, coreDrumNo: true, lotNo: true } }),
    prisma.hotSetTest.findMany({ where: { id: { in: ids("HOT_SET_TEST") } }, select: { id: true, lotNo: true, curingLog: { select: { coreDrumNo: true } } } }),
    prisma.line.findMany({ select: { id: true, name: true } }),
    prisma.boiler.findMany({ select: { id: true, name: true } }),
    prisma.shiftDef.findMany({ select: { id: true, code: true, name: true } }),
  ]);
  const lot = (l: string | null) => (l ? ` · lot ${l}` : "");
  const about = new Map<string, string>([
    ...drums.map((d) => [d.id, `Drum ${d.drumNo}`] as const),
    ...logs.map((l) => [l.id, `Drum ${l.coreDrumNo}${lot(l.lotNo)}`] as const),
    ...tests.map((t) => [t.id, `Drum ${t.curingLog.coreDrumNo}${lot(t.lotNo)}`] as const),
    ...lines.map((l) => [l.id, l.name] as const),
  ]);
  const boilerShift = (objectId: string) => {
    const [b, d, s] = objectId.split(":");
    return [boilers.find((x) => x.id === b)?.name ?? b, d, shifts.find((x) => x.id === s || x.code === s)?.name ?? s].filter(Boolean).join(" · ");
  };

  const rule = new Map(rules.map((r) => [`${r.trigger}|${r.level}`, r]));
  const byPerson = new Map<string, { e: (typeof escalations)[number]; next: string }[]>();
  for (const e of escalations) {
    const cur = rule.get(`${e.trigger}|${e.level}`);
    const nxt = rule.get(`${e.trigger}|${e.level + 1}`);
    // Both levels count from the same starting point, so the next one is due later by the difference in their delays.
    const nextDue = cur && nxt?.active ? new Date(e.dueAt.getTime() + (nxt.delayMinutes - cur.delayMinutes) * 60_000) : null;
    const next = nextDue ? `Level ${e.level + 1} ${nextDue <= now ? "was due" : "due"} ${fmtDateTime(nextDue)} → ${nxt!.recipients.map((p) => p.name).join(", ") || "nobody set"}` : "This is the last level";
    for (const name of cur?.recipients.length ? cur.recipients.map((p) => p.name) : ["Nobody set for this level"]) byPerson.set(name, [...(byPerson.get(name) ?? []), { e, next }]);
  }

  return (
    <>
      <PageHeader title="Alerts & escalations" sub="Every WhatsApp message the dashboard has sent or tried to send, and what is still open." />
      {settings.testMode && (
        <Banner>
          <strong>Test mode is on.</strong> Messages go only to the test numbers and are labelled [TEST]. Plant staff and the MD do not receive them.
        </Banner>
      )}

      <h2 className="mb-2 text-base font-semibold text-slate-900">Open escalations</h2>
      {!byPerson.size ? (
        <EmptyState>No open escalations right now.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {[...byPerson].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => (
            <Card key={name} title={`${name} · ${rows.length} open`}>
              <Table>
                <thead>
                  <tr><th>Level</th><th>What</th><th>About</th><th>Due since</th><th>Message</th><th>Next level</th></tr>
                </thead>
                <tbody>
                  {rows.sort((a, b) => b.e.level - a.e.level || a.e.dueAt.getTime() - b.e.dueAt.getTime()).map(({ e, next }) => (
                    <tr key={e.id}>
                      <td><Chip tone={e.level >= 3 ? "red" : e.level === 2 ? "amber" : "blue"}>Level {e.level}</Chip></td>
                      <td>{TRIGGER_LABEL[e.trigger]}</td>
                      <td>{e.objectType === "BOILER_SHIFT" ? boilerShift(e.objectId) : (about.get(e.objectType === "LINE" ? e.objectId.split(":")[0] : e.objectId) ?? "–")}</td>
                      <td className="whitespace-nowrap">{fmtDateTime(e.dueAt)}</td>
                      <td className="whitespace-nowrap">{e.firedAt ? `Sent ${fmtDateTime(e.firedAt)}` : "Not sent yet"}</td>
                      <td className="min-w-56">{next}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}

      <h2 id="log" className="mt-8 mb-2 scroll-mt-32 text-base font-semibold text-slate-900">Alert log</h2>
      <form method="get" action="/alerts#log" className="mb-4 grid grid-cols-2 items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4 lg:grid-cols-7">
        <Field id="trigger" label="Alert">
          <Select id="trigger" name="trigger" defaultValue={trigger ?? ""}>
            <option value="">All</option>
            {Object.entries(TRIGGER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field id="person" label="Person">
          <Select id="person" name="person" defaultValue={one("person")}>
            <option value="">All</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field id="level" label="Level">
          <Select id="level" name="level" defaultValue={level ?? ""}>
            <option value="">All</option>
            {[1, 2, 3].map((l) => <option key={l} value={l}>Level {l}</option>)}
          </Select>
        </Field>
        <Field id="status" label="Delivery">
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {Object.entries(DELIVERY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field id="from" label="From"><Input id="from" name="from" type="date" defaultValue={one("from")} /></Field>
        <Field id="to" label="To"><Input id="to" name="to" type="date" defaultValue={one("to")} /></Field>
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <LinkButton href="/alerts#log" variant="secondary">Clear</LinkButton>
        </div>
      </form>

      <Table server={{ total, page, pageSize: PAGE_SIZE, q: null, filters: {} }}>
          <thead>
            <tr><th>Sent / queued</th><th>Alert</th><th>Level</th><th>Person</th><th>Number</th><th>Delivery</th><th>Tries</th><th>Message</th></tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className={a.status === "FAILED" ? "bg-red-50" : undefined}>
                <td className="whitespace-nowrap">
                  {a.sentAt ? fmtDateTime(a.sentAt) : <span className="text-slate-600">queued {fmtDateTime(a.queuedAt)}</span>}
                </td>
                <td>{TRIGGER_LABEL[a.trigger]}{a.objectRefs.length > 0 && <div className="text-xs text-slate-600">{a.objectRefs.join(", ")}</div>}</td>
                <td>{a.level ?? "–"}</td>
                <td>{a.person?.name ?? "–"}</td>
                <td className="whitespace-nowrap tabular-nums">{(staff && a.phone) || "–"}</td>
                <td>
                  <Chip tone={DELIVERY[a.status].tone}>{DELIVERY[a.status].label}</Chip> {a.isTest && <Chip tone="amber">[TEST]</Chip>}
                  {a.error && <div className="mt-1 max-w-64 text-xs font-medium text-red-800">{a.error}</div>}
                </td>
                <td className="tabular-nums">{a.attempts}</td>
                <td className="min-w-64">
                  <details>
                    <summary className="flex min-h-11 cursor-pointer items-center text-blue-700 underline">Show message</summary>
                    <p className="pb-2 text-sm whitespace-pre-wrap text-slate-800">{a.message}</p>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
      </Table>
    </>
  );
}

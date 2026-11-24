// Open, fire and resolve escalations from the EscalationRule matrix (guide 9.1, 9.2).
import { prisma } from "@/lib/prisma";
import type { Settings } from "@/lib/settings";
import type { AlertTrigger, EscalationObject } from "@/generated/prisma/enums";
import { dueLevels, type Anchors } from "@/lib/rules/decide";
import { sendMessage, type Recipient } from "./send";
import { renderAlert } from "./templates";

/** Something that is wrong right now. `text` is its line in the message, `ref` its short name in the Alert Log. */
export type Condition = {
  trigger: AlertTrigger;
  objectType: EscalationObject;
  objectId: string;
  anchors: Anchors;
  ref: string;
  text: string;
  lengthM?: number;
};

const keyOf = (c: { trigger: string; objectType: string; objectId: string }) => `${c.trigger}|${c.objectType}|${c.objectId}`;

/**
 * `conditions` = everything currently wrong for `triggers`. Resolves open escalations whose condition
 * has cleared, fires the levels that are now due, and sends one message per person per trigger.
 * Returns the number of messages and the escalations fired in this run.
 */
export async function escalate(triggers: AlertTrigger[], conditions: Condition[], now: Date, settings: Settings) {
  const [rules, open] = await Promise.all([
    prisma.escalationRule.findMany({
      where: { active: true, trigger: { in: triggers } },
      include: { recipients: { where: { active: true }, select: { id: true, name: true, whatsapp: true } } },
    }),
    prisma.escalation.findMany({ where: { trigger: { in: triggers }, resolvedAt: null } }),
  ]);

  const active = new Map(conditions.map((c) => [keyOf(c), c]));
  const cleared = open.filter((e) => !active.has(keyOf(e))).map((e) => e.id);
  if (cleared.length) await prisma.escalation.updateMany({ where: { id: { in: cleared } }, data: { resolvedAt: now } });

  const fired = new Map<string, Set<number>>();
  for (const e of open) fired.set(keyOf(e), (fired.get(keyOf(e)) ?? new Set()).add(e.level));

  const wanted = conditions.flatMap((c) =>
    dueLevels(
      rules.filter((r) => r.trigger === c.trigger),
      c.anchors,
      fired.get(keyOf(c)) ?? new Set(),
      now,
    ).map((d) => ({ trigger: c.trigger, objectType: c.objectType, objectId: c.objectId, level: d.level, dueAt: d.dueAt, firedAt: now })),
  );
  if (!wanted.length) return { alerts: 0, claimed: [] };

  // The unique key (trigger, objectType, objectId, level) decides: a row that already exists is skipped,
  // so a level fires once even if two runs overlap. Claim first, send after: a crash in between loses
  // that one message rather than sending it twice.
  const claimed = await prisma.escalation.createManyAndReturn({ data: wanted, skipDuplicates: true });

  const groups = new Map<string, { person: Recipient; trigger: AlertTrigger; level: number; items: Condition[]; ids: string[] }>();
  for (const e of claimed) {
    const rule = rules.find((r) => r.trigger === e.trigger && r.level === e.level);
    const item = active.get(keyOf(e));
    if (!rule || !item) continue;
    for (const person of rule.recipients) {
      const k = `${person.id}|${e.trigger}`;
      const g = groups.get(k) ?? { person, trigger: e.trigger, level: 0, items: [], ids: [] };
      g.level = Math.max(g.level, e.level);
      if (!g.items.includes(item)) g.items.push(item);
      g.ids.push(e.id);
      groups.set(k, g);
    }
  }

  let alerts = 0;
  for (const g of groups.values()) {
    const sent = await sendMessage(
      { trigger: g.trigger, level: g.level, person: g.person, text: renderAlert(g.trigger, g.level, g.items), objectRefs: g.items.map((i) => i.ref) },
      settings,
    );
    alerts += sent.length;
    if (sent[0]) await prisma.escalation.updateMany({ where: { id: { in: g.ids } }, data: { alertId: sent[0].id } });
  }
  return { alerts, claimed };
}

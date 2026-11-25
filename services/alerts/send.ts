// The one place a WhatsApp message leaves the dashboard (guide D4). Every message is an Alert row.
import { prisma } from "@/lib/prisma";
import type { Settings } from "@/lib/settings";
import type { AlertStatus, AlertTrigger } from "@/generated/prisma/enums";

export type Recipient = { id: string; name: string; whatsapp: string | null };
export type Message = { trigger: AlertTrigger; level?: number | null; person: Recipient; text: string; objectRefs?: string[] };

// Evolution API v2: POST /message/sendText/{instance} with { number, text }.
// (v1 took { number, textMessage: { text } } – change the body here if the server is v1.)
async function evolutionSendText(number: string, text: string): Promise<string | null> {
  const { EVOLUTION_API_URL: url, EVOLUTION_API_KEY: apikey, EVOLUTION_INSTANCE: instance } = process.env;
  const res = await fetch(`${url!.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(instance!)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apikey! },
    body: JSON.stringify({ number, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Evolution API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json().catch(() => null)) as { key?: { id?: string } } | null;
  return body?.key?.id ?? null;
}

/**
 * Log and send one message. Never throws for a failed send: the failure is recorded on the alert.
 * Test mode: the text is labelled [TEST] and goes only to settings.testNumbers.
 */
export async function sendMessage(m: Message, settings: Settings): Promise<{ id: string; status: AlertStatus }[]> {
  const { EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE } = process.env;
  const configured = !!(EVOLUTION_API_URL && EVOLUTION_API_KEY && EVOLUTION_INSTANCE);
  const test = settings.testMode;
  const text = test ? `[TEST] For ${m.person.name}\n${m.text}` : m.text;
  const numbers: (string | null)[] = test ? (settings.testNumbers.length ? settings.testNumbers : [null]) : [m.person.whatsapp];
  const out: { id: string; status: AlertStatus }[] = [];

  for (const raw of numbers) {
    const phone = raw?.replace(/\D/g, "") || null; // digits with country code, no "+"
    const skip = !phone ? (test ? "No test number set" : "Person has no WhatsApp number") : !configured ? "WhatsApp not configured" : null;
    const alert = await prisma.alert.create({
      data: {
        trigger: m.trigger,
        level: m.level ?? null,
        personId: m.person.id,
        phone,
        message: text,
        objectRefs: m.objectRefs ?? [],
        route: "API",
        isTest: test,
        status: skip ? "SKIPPED" : "QUEUED",
        error: skip,
      },
    });
    if (skip || !phone) {
      out.push({ id: alert.id, status: "SKIPPED" });
      continue;
    }
    const max = Math.max(1, settings.maxSendAttempts || 1);
    let attempts = 0;
    let error: string | null = null;
    let providerId: string | null = null;
    while (attempts < max) {
      attempts++;
      try {
        providerId = await evolutionSendText(phone, text);
        error = null;
        break;
      } catch (e) {
        error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      }
    }
    const status: AlertStatus = error ? "FAILED" : "SENT";
    await prisma.alert.update({ where: { id: alert.id }, data: { status, attempts, error, providerId, sentAt: error ? null : new Date() } });
    out.push({ id: alert.id, status });
  }
  return out;
}

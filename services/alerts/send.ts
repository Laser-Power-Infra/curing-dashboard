// The one place a WhatsApp message leaves the dashboard (guide D4). Every message is an Alert row.
import { randomUUID } from "node:crypto";
import amqp from "amqplib";
import { prisma } from "@/lib/prisma";
import type { Settings } from "@/lib/settings";
import type { AlertStatus, AlertTrigger } from "@/generated/prisma/enums";

export type Recipient = { id: string; name: string; whatsapp: string | null };
export type Message = { trigger: AlertTrigger; level?: number | null; person: Recipient; text: string; objectRefs?: string[] };

const QUEUE = "notifications";

/**
 * Put one message on the company's notification queue; a separate service sends the WhatsApp.
 * `to` is digits with country code. Returns the message id. Throws if the broker did not accept it.
 */
// shortcut: one connection per message, fine for a handful of alerts per run; share a connection if runs send hundreds.
export async function queueWhatsApp(to: string, text: string): Promise<string> {
  const id = randomUUID();
  const conn = await amqp.connect(process.env.RABBITMQ_URL!, { timeout: 8000 });
  try {
    const ch = await conn.createConfirmChannel();
    await ch.checkQueue(QUEUE); // the queue belongs to the sender service: fail if it is missing, never create it
    ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify({ id, version: 1, notification_platform: "whatsapp", recipient: { to }, text })), {
      persistent: true,
      contentType: "application/json",
      messageId: id,
    });
    await ch.waitForConfirms();
  } finally {
    await conn.close().catch(() => {});
  }
  return id;
}

/**
 * Log and queue one message. Never throws for a failed send: the failure is recorded on the alert.
 * SENT means the queue accepted it; delivery to the phone is the sender service's job.
 * Test mode: the text is labelled [TEST] and goes only to settings.testNumbers.
 */
export async function sendMessage(m: Message, settings: Settings): Promise<{ id: string; status: AlertStatus }[]> {
  const configured = !!process.env.RABBITMQ_URL;
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
        providerId = await queueWhatsApp(phone, text);
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

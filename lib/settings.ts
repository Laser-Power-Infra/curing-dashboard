// Typed view over the key–value `settings` table (guide 3.13). Keys are seeded in seed/seed.ts.
import { prisma } from "@/lib/prisma";

const DEFAULTS = {
  "rules.curingStartLimitHours": 6,
  "rules.testOverdueGraceHours": 2,
  "rules.curingLogSilenceHours": 4,
  "rules.lineRunningWindowHours": 4,
  "data.staleFeedHours": 2,
  "alerts.enabledFrom": null as string | null,
  "alerts.testMode": true,
  "alerts.testNumbers": [] as string[],
  "alerts.maxSendAttempts": 3,
  "ui.ageingBucketsHours": [24, 48, 72],
};

export type Settings = {
  curingStartLimitHours: number;
  testOverdueGraceHours: number;
  curingLogSilenceHours: number;
  lineRunningWindowHours: number;
  staleFeedHours: number;
  /** Only drums unloaded on/after this can create alerts. null = no alerts at all (guide 4.3). */
  alertsEnabledFrom: Date | null;
  testMode: boolean;
  testNumbers: string[];
  maxSendAttempts: number;
  ageingBucketsHours: number[];
};

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.setting.findMany();
  const v = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) } as typeof DEFAULTS;
  const from = v["alerts.enabledFrom"] ? new Date(v["alerts.enabledFrom"]) : null;
  return {
    curingStartLimitHours: Number(v["rules.curingStartLimitHours"]),
    testOverdueGraceHours: Number(v["rules.testOverdueGraceHours"]),
    curingLogSilenceHours: Number(v["rules.curingLogSilenceHours"]),
    lineRunningWindowHours: Number(v["rules.lineRunningWindowHours"]),
    staleFeedHours: Number(v["data.staleFeedHours"]),
    alertsEnabledFrom: from && !Number.isNaN(from.getTime()) ? from : null,
    // Anything other than an explicit false keeps test mode on (guide 12.6).
    testMode: v["alerts.testMode"] !== false,
    testNumbers: Array.isArray(v["alerts.testNumbers"]) ? v["alerts.testNumbers"].map(String) : [],
    maxSendAttempts: Number(v["alerts.maxSendAttempts"]),
    ageingBucketsHours: Array.isArray(v["ui.ageingBucketsHours"]) ? v["ui.ageingBucketsHours"].map(Number) : [24, 48, 72],
  };
}

// Every edit goes to the audit log (guide 3.14).
import { prisma } from "@/lib/prisma";
import type { AuditAction, AuditSource } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

type Db = Pick<typeof prisma, "auditLog"> | Prisma.TransactionClient;
// Dates and Decimals become strings; null / undefined are stored as "no value".
const json = (v: unknown) => (v == null ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * Write one audit row per changed field. Fields whose old and new value are equal are skipped.
 * Pass `db` = the transaction client to write inside a transaction.
 *
 *   await audit("missing_drum_tracker", row.id, "UPDATE", { reason: { old: row.reason, new: reason } }, user.email);
 *   await audit("curing_logs", log.id, "CREATE", null, user.email);
 */
export async function audit(
  tableName: string,
  rowId: string,
  action: AuditAction,
  changes: Record<string, { old?: unknown; new?: unknown }> | null,
  changedBy: string,
  source: AuditSource = "UI",
  db: Db = prisma,
) {
  const base = { tableName, rowId, action, changedBy, source };
  const data = changes
    ? Object.entries(changes)
        .filter(([, c]) => JSON.stringify(json(c.old)) !== JSON.stringify(json(c.new)))
        .map(([field, c]) => ({ ...base, field, oldValue: json(c.old), newValue: json(c.new) }))
    : [base];
  if (data.length) await db.auditLog.createMany({ data });
}

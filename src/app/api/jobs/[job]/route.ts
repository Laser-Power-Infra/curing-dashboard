// Background jobs W1–W7 (guide 10):  /api/jobs/w1 … /api/jobs/w7
// Every call needs the header   Authorization: Bearer <CRON_SECRET>.   GET (Vercel cron) and POST (n8n) both work.
//
// W1 drum sync – the n8n workflow POSTs the "Drum Register" rows to /api/jobs/w1 as JSON:
//   {
//     "rows": [
//       {
//         "gridEntryId": "331105",              required – the unique key
//         "line":        "Sioplas 3",           required – line name or code (SIOPLAS_3); lines not in scope are skipped
//         "unloadDate":  "2026-11-14",          required – YYYY-MM-DD
//         "unloadTime":  "14:30",               optional – HH:mm, IST. Leave out when only the date is known
//         "prodOrders":  "P126Y-00308, P126Y-00790",   one string; several orders separated by commas
//         "mcNo":        "…",                   optional
//         "party":       "…",                   optional
//         "coreItem":    "300 SQ. MM. CORE INSULATED 11kv (SIO) (CESC) (IS)",   required
//         "drumNo":      "879",                 required
//         "drumSize":    "…",                   optional
//         "lengthM":     5075,                  required – metres
//         "enteredBy":   "…",                   optional
//         "stockStatus": "In stock"             optional
//       }
//     ]
//   }
// Only Grid IDs that are not in the dashboard yet are added. An existing drum is never changed, except
// that a blank unload time is filled when the feed now has one. The reply lists the counts and, for each
// rejected row, its row number (from 1), Grid ID and the reason:
//   { "ok": true, "job": "W1_DRUM_SYNC", "rowsRead": 40, "rowsChanged": 3, "alerts": 0,
//     "details": { "inserted": 3, "timeFilled": 0, "alreadyThere": 36, "outOfScope": 0, "rejectedCount": 1,
//                  "rejected": [ { "row": 7, "gridEntryId": "331200", "reason": "Drum no is blank" } ] } }
// A GET, or a POST without rows, records a successful run with zero rows.
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { alertJobFailure, boilerWatch, curingLogWatch, drumSync, mdSummary, rulesJob, type JobResult } from "../jobs";

export const maxDuration = 60;

const JOBS: Record<string, { name: string; run: (body: unknown) => Promise<JobResult> }> = {
  w1: { name: "W1_DRUM_SYNC", run: drumSync },
  w2: { name: "W2_MISSING_CHECK", run: rulesJob("job:W2") },
  w3: { name: "W3_CURING_LOG_WATCH", run: curingLogWatch },
  w4: { name: "W4_TEST_WATCH", run: rulesJob("job:W4") },
  w5: { name: "W5_TRANSFER_REQUISITION", run: rulesJob("job:W5") },
  w6: { name: "W6_BOILER_WATCH", run: boilerWatch },
  w7: { name: "W7_MD_SUMMARY", run: mdSummary },
};

const digest = (s: string) => createHash("sha256").update(s).digest();

async function handle(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  // Hashing first gives equal lengths, so the compare takes the same time for any input.
  if (!secret || !timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`)))
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const job = JOBS[(await params).job.toLowerCase()];
  if (!job) return Response.json({ ok: false, error: "Unknown job" }, { status: 404 });

  let body: unknown = null;
  if (req.method === "POST") {
    const text = await req.text();
    try {
      body = text.trim() ? JSON.parse(text) : null;
    } catch {
      return Response.json({ ok: false, error: "Body is not valid JSON" }, { status: 400 });
    }
  }

  const run = await prisma.jobRun.create({ data: { job: job.name } });
  try {
    const r = await job.run(body);
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "SUCCESS", finishedAt: new Date(), rowsRead: r.rowsRead, rowsChanged: r.rowsChanged, alertsQueued: r.alerts, details: r.details },
    });
    return Response.json({ ok: true, job: job.name, ...r });
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    console.error(`[${job.name}]`, e);
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error } });
    await alertJobFailure(job.name, run.id, error).catch((err) => console.error("[JOB_FAILURE alert]", err));
    return Response.json({ ok: false, job: job.name, error: error.slice(0, 300) }, { status: 500 });
  }
}

export { handle as GET, handle as POST };

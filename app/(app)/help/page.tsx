// How to Use – for the plant team (guide 6.11, 12.7). Limits and the alert table come from live settings.
import type { ReactNode } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { viewer } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fmtDuration } from "@/lib/format";
import { Card, Chip, EmptyState, PageHeader, StatusChip, Table } from "@/components/ui";
import type { AlertTrigger } from "@/generated/prisma/enums";
import { TRIGGER_LABEL } from "@/lib/alert-labels";

const A = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className="font-medium text-blue-700 underline">{children}</Link>;
const Steps = ({ children }: { children: ReactNode }) => <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">{children}</ol>;

export default async function HelpPage() {
  await viewer();
  const [s, rules] = await Promise.all([
    getSettings(),
    prisma.escalationRule.findMany({ where: { active: true }, include: { recipients: true }, orderBy: [{ trigger: "asc" }, { level: "asc" }] }),
  ]);
  const limit = fmtDuration(s.curingStartLimitHours);
  const grace = fmtDuration(s.testOverdueGraceHours);
  const statuses: [string, string][] = [
    ["MADE", `Drum is unloaded from the line. It is not in curing yet, but still within ${limit}.`],
    ["MISSING", `More than ${limit} since unload and still no curing entry. Load it and enter it now.`],
    ["IN_CURING", "Curing has started and has not ended yet."],
    ["AWAITING_TEST", "Curing has ended. The hot set test is not entered yet."],
    ["TEST_OVERDUE", `No test result ${grace} after the test was due.`],
    ["FAILED", "The hot set test failed. The drum is on hold. It must be re-cured and pass before it can be sent."],
    ["PASSED", "The hot set test passed. The drum is ready to go to Polypark."],
    ["REQUISITION_RAISED", "The drum is on a transfer requisition, not yet dispatched."],
    ["SENT", "The drum has been dispatched to Polypark."],
    ["DATA_ERROR", "The dashboard cannot tell which curing entry belongs to which drum. A person must link them."],
    ["NOT_CURING_ITEM", "Compact or bare conductor. It is not cured, so it is left out of every list and count."],
    ["LATE", `Missing drum tracker: the drum did go into curing, but more than ${limit} after unload.`],
    ["CURED", `Missing drum tracker: the drum went into curing within ${limit}.`],
    ["UNDER_CURED", "Curing ended before the approved hours of the recipe."],
    ["NO_RECIPE", "There is no approved recipe in use for this compound and product."],
  ];
  const triggers = [...new Set(rules.map((r) => r.trigger))] as AlertTrigger[];
  const levels = [...new Set(rules.map((r) => r.level))].sort();

  return (
    <>
      <PageHeader title="How to use" sub="A short guide for the plant team." />
      <div className="grid max-w-4xl gap-4">
        <Card title={`The ${limit} rule`}>
          <p className="text-sm text-slate-800">
            Every insulated core or covered conductor drum from Sioplas 3 and 4 must be <strong>in curing within {limit} of unloading</strong>. If it is not, it shows as{" "}
            <StatusChip status="MISSING" /> on <A href="/tracker">Missing drums</A> and WhatsApp alerts start. A drum stays on that list until it has a curing entry. Nothing is ever deleted.
          </p>
        </Card>

        <Card title="What each status means">
          <dl className="grid gap-2 text-sm">
            {statuses.map(([status, text]) => (
              <div key={status} className="grid gap-1 sm:grid-cols-[13rem_1fr]">
                <dt><StatusChip status={status} /></dt>
                <dd className="text-slate-800">{text}</dd>
              </div>
            ))}
            <div className="grid gap-1 sm:grid-cols-[13rem_1fr]">
              <dt><Chip>time unknown</Chip></dt>
              <dd className="text-slate-800">
                We know the date the drum was unloaded but not the time. The {limit} check cannot be done for it, so it never shows as Missing and no alert is sent. It still needs its curing entry.
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Enter a curing row (curing team)">
          <Steps>
            <li>Open <A href="/curing">Curing log</A> and tap <strong>New curing entry</strong>.</li>
            <li>Choose the drum from the list of drums waiting for curing. Check the drum no, line and unload time. The same drum no can come twice in a day, so pick the right one.</li>
            <li>Choose the tank or autoclave and the compound. The start time is now; change it if curing started earlier.</li>
            <li>The approved hours and the expected end time are shown from the recipe. Save.</li>
          </Steps>
        </Card>

        <Card title="End curing (curing team)">
          <Steps>
            <li>In <A href="/curing">Curing log</A>, find the drum that is <StatusChip status="IN_CURING" /> and tap <strong>End curing</strong>.</li>
            <li>Enter the end time and the visual check.</li>
            <li>If the hours are less than the approved hours you will see an <StatusChip status="UNDER_CURED" /> warning before you save. Hours, deviation and the test due time are worked out by the dashboard. You never type them.</li>
          </Steps>
        </Card>

        <Card title="Enter a hot set test (lab)">
          <Steps>
            <li>Open <A href="/tests">Hot set test</A>. Drums are listed by test due time; overdue ones are marked.</li>
            <li>Enter the sample end, readings and <strong>Result: Pass or Fail</strong>. The result you enter is final. The dashboard does not work it out from the percentages.</li>
            <li>Fail puts the drum on hold. It must be cured again (a new curing row) and tested again.</li>
          </Steps>
        </Card>

        <Card title="Enter a boiler reading (boiler team)">
          <Steps>
            <li>Open <A href="/boiler">Boiler log</A>. Today and the current shift are already chosen.</li>
            <li>Choose the boiler, enter temperature and pressure, and save. One reading for each boiler in each shift.</li>
            <li>A red <strong>Missing</strong> box means that shift ended with no reading. Tap the box to fill it.</li>
          </Steps>
        </Card>

        <Card title="Raise a requisition (transfer team)">
          <Steps>
            <li>Open <A href="/transfers">Ready to send</A>. It lists passed drums, oldest first.</li>
            <li>Tick the drums that are going and tap <strong>Raise requisition</strong>. You get a requisition number; open it to print or share.</li>
            <li>When the drums leave Kharagpur, tap <strong>Mark dispatched</strong>. All drums on it become <StatusChip status="SENT" />.</li>
            <li>Failed drums are shown separately and cannot be ticked.</li>
          </Steps>
        </Card>

        <Card title="Who gets which WhatsApp alert, and when">
          {!rules.length ? (
            <EmptyState>No alert levels are set up yet.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr><th>Alert</th>{levels.map((l) => <th key={l}>Level {l}</th>)}</tr>
              </thead>
              <tbody>
                {triggers.map((t) => (
                  <tr key={t}>
                    <td className="font-medium">{TRIGGER_LABEL[t]}</td>
                    {levels.map((l) => {
                      const r = rules.find((x) => x.trigger === t && x.level === l);
                      return <td key={l} className="min-w-44">{r ? <>{r.description}<div className="text-xs text-slate-600">{r.recipients.map((p) => p.name).join(", ") || "nobody set"}</div></> : "–"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-sm text-slate-800">
            Each person gets one message per drum per level. Alerts stop as soon as the problem is fixed, for example when the drum gets its curing entry. Every message is listed on <A href="/alerts">Alerts</A>.
          </p>
        </Card>

        <Card title="Test mode">
          <p className="text-sm text-slate-800">
            Test mode is <strong>{s.testMode ? "ON" : "OFF"}</strong> now. While it is on, WhatsApp alerts go only to the test numbers and start with [TEST]; plant staff and the MD do not get them. It is switched off only after the MD has seen the test results and approved live alerts.
          </p>
        </Card>
      </div>
    </>
  );
}

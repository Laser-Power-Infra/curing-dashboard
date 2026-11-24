import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/auth";
import { fmtDateTime, fmtM, toIstInput } from "@/lib/format";
import { Banner, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { TestForm } from "./form";

export default async function NewTestPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const { log: logId } = await searchParams;
  const log = typeof logId === "string" ? await prisma.curingLog.findUnique({ where: { id: logId }, include: { hotSetTests: { take: 1 } } }) : null;

  return (
    <>
      <PageHeader title="Enter hot set result">
        <LinkButton variant="secondary" href="/tests">Back to tests due</LinkButton>
      </PageHeader>
      {!log ? (
        <EmptyState>Choose a drum from the Tests due list</EmptyState>
      ) : !log.curingEndAt ? (
        <EmptyState>Curing has not ended for drum {log.coreDrumNo} yet</EmptyState>
      ) : log.testResult || log.hotSetTests.length ? (
        <EmptyState>A result is already entered for drum {log.coreDrumNo}</EmptyState>
      ) : !can(user, "testEntry") ? (
        <Banner>Only the lab can enter hot set results.</Banner>
      ) : (
        <div className="max-w-xl space-y-4">
          <Card>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm [&_dd]:font-medium [&_dd]:text-slate-900 [&_dt]:text-xs [&_dt]:text-slate-600">
              <div><dt>Lot no</dt><dd>{log.lotNo ?? "–"}</dd></div>
              <div><dt>Drum no</dt><dd>{log.coreDrumNo}{log.cycleNo > 1 && ` (cycle ${log.cycleNo})`}</dd></div>
              <div><dt>Length</dt><dd>{fmtM(log.lengthM)}</dd></div>
              <div><dt>Curing ended</dt><dd>{fmtDateTime(log.curingEndAt)}</dd></div>
              <div><dt>Test due</dt><dd>{fmtDateTime(log.testDueAt)}</dd></div>
            </dl>
          </Card>
          <TestForm curingLogId={log.id} drumNo={log.coreDrumNo} now={toIstInput(new Date())} />
        </div>
      )}
    </>
  );
}

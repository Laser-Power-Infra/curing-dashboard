// Print-friendly transfer requisition (guide 6.6).
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { viewer } from "@/lib/auth";
import { fmtDateTime, fmtKm, fmtM } from "@/lib/format";
import { LinkButton, StatusChip } from "@/components/ui";
import { PrintButton } from "@/components/transfers/print-button";

export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  await viewer();
  const { id } = await params;
  const req = await prisma.requisition.findUnique({
    where: { id },
    include: { curingLogs: { include: { drum: { include: { line: true } } }, orderBy: { coreDrumNo: "asc" } } },
  });
  if (!req) notFound();

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 print:border-0 print:p-0">
      {/* The shell (top bar, navigation) is not part of the printed requisition. */}
      <style>{`@media print { header, nav, .no-print { display: none !important } main { padding: 0 !important } }`}</style>
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <LinkButton href="/transfers" variant="secondary">Back</LinkButton>
        <PrintButton />
      </div>

      <h1 className="text-xl font-semibold text-slate-900">Transfer requisition {req.reqNo}</h1>
      <p className="text-sm text-slate-600">Laser Power &amp; Infra · Kharagpur → Polypark · cured and hot set passed drums</p>
      <dl className="my-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-slate-600">Status</dt><dd><StatusChip status={req.status} /></dd></div>
        <div><dt className="text-xs text-slate-600">Raised</dt><dd>{fmtDateTime(req.raisedAt)}</dd></div>
        <div><dt className="text-xs text-slate-600">Raised by</dt><dd className="break-all">{req.raisedBy ?? "–"}</dd></div>
        <div><dt className="text-xs text-slate-600">Dispatched</dt><dd>{fmtDateTime(req.dispatchedAt)}</dd></div>
      </dl>

      {!req.curingLogs.length ? (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          No drums on this requisition{req.status === "CANCELLED" ? " – it was cancelled and its drums went back to the ready list" : ""}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left">
            <thead>
              <tr><th>#</th><th>Lot no</th><th>Drum no</th><th>Line</th><th>Item</th><th className="text-right">Length</th></tr>
            </thead>
            <tbody>
              {req.curingLogs.map((l, i) => (
                <tr key={l.id}>
                  <td>{i + 1}</td>
                  <td>{l.lotNo ?? "–"}</td>
                  <td className="font-medium">{l.coreDrumNo}</td>
                  <td>{l.drum?.line.name ?? "–"}</td>
                  <td>{l.productName ?? l.drum?.coreItem ?? "–"}</td>
                  <td className="text-right tabular-nums">{fmtM(l.lengthM ?? l.drum?.lengthM)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="text-right font-semibold">Total · {req.curingLogs.length} drum{req.curingLogs.length === 1 ? "" : "s"}</td>
                <td className="text-right font-semibold tabular-nums">{fmtKm(req.totalLengthM)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

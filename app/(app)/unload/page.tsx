import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, viewer } from "@/lib/auth";
import { fmtDateOnly, fmtDateTime, fmtM, toIstInput } from "@/lib/format";
import { Banner, Card, EmptyState, PageHeader, StatusChip, Table } from "@/components/ui";
import { NewDrumForm, SetTimeForm } from "@/components/unload/forms";

export default async function UnloadPage() {
  const user = await viewer();
  const mayEdit = can(user, "unloadEntry");
  const noTimeWhere = { unloadedAt: null, isCuringItem: true, line: { inScope: true } };
  const [lines, products, noTime, noTimeCount, recent] = await Promise.all([
    prisma.line.findMany({ where: { inScope: true, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.drum.findMany({ where: noTimeWhere, include: { line: true }, orderBy: [{ unloadDate: "desc" }, { createdAt: "desc" }], take: 50 }),
    prisma.drum.count({ where: noTimeWhere }),
    prisma.drum.findMany({ where: { source: "MANUAL" }, include: { line: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  return (
    <>
      <PageHeader title="Unload entry" sub="Add a drum by hand, or fill in a missing unload time" />
      {!mayEdit && <Banner>You can view this page. Only the curing and planning teams can add drums or set unload times.</Banner>}

      <div className="space-y-6">
        {mayEdit && (
          <Card title="New drum">
            <NewDrumForm lines={lines} products={products.map((p) => p.name)} now={toIstInput(new Date())} />
          </Card>
        )}

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Drums with no unload time{noTimeCount > noTime.length && ` – latest ${noTime.length} of ${noTimeCount}`}
          </h2>
          {noTime.length === 0 ? (
            <EmptyState>Every drum has an unload time</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {noTime.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="text-sm">
                    <Link href={`/drums/${d.id}`} className="font-semibold text-blue-700 underline">Drum {d.drumNo}</Link>
                    <span className="text-slate-600"> · {d.line.name} · {fmtDateOnly(d.unloadDate)} · Grid ID {d.gridEntryId}</span>
                    <div className="text-slate-600">{d.coreItem} · {fmtM(d.lengthM)}</div>
                  </div>
                  {mayEdit && <SetTimeForm drumId={d.id} label={`Unload time on ${fmtDateOnly(d.unloadDate)} for drum ${d.drumNo}`} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Recent manual entries</h2>
          {recent.length === 0 ? (
            <EmptyState>No drums entered by hand yet</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr><th>Grid ID</th><th>Drum no</th><th>Line</th><th>Unloaded</th><th>Core item</th><th>Length</th><th>Status</th><th>Entered by</th></tr>
              </thead>
              <tbody>
                {recent.map((d) => (
                  <tr key={d.id}>
                    <td><Link href={`/drums/${d.id}`} className="font-medium text-blue-700 underline">{d.gridEntryId}</Link></td>
                    <td>{d.drumNo}</td>
                    <td className="whitespace-nowrap">{d.line.name}</td>
                    <td className="whitespace-nowrap">{d.unloadedAt ? fmtDateTime(d.unloadedAt) : `${fmtDateOnly(d.unloadDate)} · time unknown`}</td>
                    <td>{d.coreItem}</td>
                    <td className="whitespace-nowrap">{fmtM(d.lengthM)}</td>
                    <td><StatusChip status={d.status} /></td>
                    <td>{d.enteredBy ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}

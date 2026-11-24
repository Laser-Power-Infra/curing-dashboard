import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/auth";
import { fmtDateOnly, fmtDateTime, fmtM, toIstInput } from "@/lib/format";
import { Banner, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { NewCuringForm } from "./form";

export default async function NewCuringPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const { drum: wanted } = await searchParams;
  const waiting = { isCuringItem: true, line: { inScope: true }, OR: [{ curingLogs: { none: {} } }, { curingLogs: { some: { testResult: "FAIL" as const } } }] };
  const include = { line: true, curingLogs: { orderBy: { cycleNo: "desc" as const }, take: 1 } };
  const [oldest, asked, units, recipes] = await Promise.all([
    // shortcut: the 200 oldest waiting drums (plus the one asked for by ?drum=); add paging if the backlog ever grows past that.
    prisma.drum.findMany({ where: waiting, include, orderBy: [{ unloadDate: "asc" }, { unloadedAt: "asc" }], take: 200 }),
    typeof wanted === "string" ? prisma.drum.findFirst({ where: { id: wanted, ...waiting }, include }) : null,
    prisma.curingUnit.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.curingRecipe.findMany({ distinct: ["compound"], select: { compound: true }, orderBy: { compound: "asc" } }),
  ]);
  // A drum with a failed cycle waits again only while that failed cycle is still its latest one.
  const drums = (asked && !oldest.some((d) => d.id === asked.id) ? [asked, ...oldest] : oldest)
    .filter((d) => !d.curingLogs[0] || d.curingLogs[0].testResult === "FAIL")
    .map((d) => ({
      id: d.id,
      drumNo: d.drumNo,
      line: d.line.name,
      unload: d.unloadedAt ? fmtDateTime(d.unloadedAt) : `${fmtDateOnly(d.unloadDate)} · time unknown`,
      item: d.coreItem,
      length: fmtM(d.lengthM),
      gridEntryId: d.gridEntryId,
      productId: d.productId,
      recure: Boolean(d.curingLogs[0]),
    }));

  return (
    <>
      <PageHeader title="New curing entry">
        <LinkButton variant="secondary" href="/curing">Back to curing log</LinkButton>
      </PageHeader>
      {!can(user, "curingEntry") ? (
        <Banner>Only the curing team can add curing entries.</Banner>
      ) : drums.length === 0 ? (
        <EmptyState>No drums are waiting for curing right now</EmptyState>
      ) : (
        <NewCuringForm
          drums={drums}
          initialDrumId={drums.find((d) => d.id === wanted)?.id ?? drums[0].id}
          units={units}
          compounds={recipes.map((r) => r.compound)}
          now={toIstInput(new Date())}
        />
      )}
    </>
  );
}

import { prisma } from "@/lib/prisma";
import { can, viewer } from "@/lib/auth";
import { findRecipe } from "@/services/rules";
import { fmtDateTime, fmtDuration, toIstInput } from "@/lib/format";
import { Banner, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { EndCuringForm } from "@/components/curing/end-form";

export default async function EndCuringPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await viewer();
  const { id } = await params;
  const log = await prisma.curingLog.findUnique({ where: { id }, include: { curingUnit: true } });
  const recipe = log?.xlpeCompound && log.productId ? await findRecipe(log.xlpeCompound, log.productId) : null;

  return (
    <>
      <PageHeader
        title="End curing"
        sub={log && `Drum ${log.coreDrumNo}${log.lotNo ? ` · Lot ${log.lotNo}` : ""} · ${log.curingUnit?.name ?? log.chamberTankText ?? "tank not set"} · started ${fmtDateTime(log.curingStartAt)} · approved ${recipe ? fmtDuration(recipe.approvedCuringHrs) : "– (no recipe)"}`}
      >
        <LinkButton variant="secondary" href="/curing">Back to curing log</LinkButton>
      </PageHeader>
      {!log ? (
        <EmptyState>This curing entry was not found</EmptyState>
      ) : log.curingEndAt ? (
        <EmptyState>Curing was already ended for this drum at {fmtDateTime(log.curingEndAt)}</EmptyState>
      ) : !can(user, "curingEntry") ? (
        <Banner>Only the curing team can end curing.</Banner>
      ) : (
        <EndCuringForm id={log.id} startMs={log.curingStartAt.getTime()} plannedHrs={recipe?.approvedCuringHrs ?? null} now={toIstInput(new Date())} />
      )}
    </>
  );
}

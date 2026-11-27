// Operator home: "what to do now" – one card per open drum, the late ones first. Office numbers live at /office.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { DrumStatus, type AlertTrigger } from "@/generated/prisma/enums";
import { can, viewer, type Perm, type SessionUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { drumScope } from "@/lib/scope";
import { fmtKm, fmtPct, istDay, istDayStart } from "@/lib/format";
import { L } from "@/lib/labels";
import { kindOf, nextAction, type Action, type Kind } from "@/lib/next-action";
import { compliance, passRate } from "@/services/rules";
import { Bi, EmptyState, STATUS } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { one, qs, type SP } from "@/components/drums/shared";
import { markDispatched, raiseRequisition } from "@/actions/transfers";
import { BIG_BTN, BIG_FORM, DrumCard } from "@/components/home/drum-card";
import { ladderLevels } from "@/components/home/ladder";
import { Tour } from "@/components/home/tour";

const DAY_MS = 86_400_000;
// shortcut: at most this many open drums per team (oldest unload first) and this many green cards drawn; add paging if the backlog outgrows it.
const CAP = 200;
const GREEN_SHOWN = 30;

const VIEWS = [
  { view: "all", label: "सब / All" },
  { view: "curing", label: "Curing" },
  { view: "lab", label: "Lab / Test" },
  { view: "transfer", label: "भेजना / Transfer" },
] as const;
type View = (typeof VIEWS)[number]["view"];

// The job in words, the big button's label and the permission it needs.
const ACTIONS: Record<Exclude<Action, "none">, { text: string; button: string; perm: Perm }> = {
  load: { text: "टैंक में डालें / Put in tank", button: L.loadInTank, perm: "curingEntry" },
  endCuring: { text: "Curing खत्म करें / End curing", button: L.curingEnded, perm: "curingEntry" },
  test: { text: "Test का नतीजा भरें / Enter test result", button: L.testResult, perm: "testEntry" },
  requisition: { text: "Requisition बनाएँ / Raise requisition", button: L.raiseRequisition, perm: "transfer" },
  dispatch: { text: "Polypark भेजें / Dispatch to Polypark", button: L.dispatched, perm: "transfer" },
};
// Whose rule names the responsible person of a card.
const OWNER: Record<Kind, AlertTrigger> = { curing: "DRUM_NOT_IN_CURING", lab: "TEST_OVERDUE", transfer: "PASSED_NO_REQUISITION" };
const TONE_ORDER = { red: 0, amber: 1, green: 2 };

function defaultView(user: SessionUser): View {
  if (user.roles.some((r) => r === "MD" || r === "PRODUCTION_HEAD" || r === "ADMIN")) return "all";
  const mine = ([["CURING", "curing"], ["LAB", "lab"], ["TRANSFER", "transfer"]] as const).filter(([role]) => user.roles.includes(role));
  return mine.length === 1 ? mine[0][1] : "all";
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await viewer();
  const asked = one((await searchParams).view);
  const view = VIEWS.find((v) => v.view === asked)?.view ?? defaultView(user);
  const now = new Date();
  const today = istDay(now);
  const scope = drumScope();
  const kinds = (["curing", "lab", "transfer"] as const).filter((k) => view === "all" || view === k);
  const openStatuses = Object.values(DrumStatus).filter((s) => s !== "SENT" && s !== "NOT_CURING_ITEM");

  const [settings, byStatus, unloadedToday, tests, rules, ...perKind] = await Promise.all([
    getSettings(),
    prisma.drum.groupBy({ by: ["status"], where: scope, _count: { _all: true }, _sum: { lengthM: true } }),
    prisma.drum.findMany({
      where: { ...scope, unloadDate: today },
      select: { unloadedAt: true, status: true, curingLogs: { where: { cycleNo: 1 }, select: { curingStartAt: true }, take: 1 } },
    }),
    prisma.hotSetTest.findMany({ where: { testedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) }, curingLog: { cycleNo: 1, drum: scope } }, select: { result: true } }),
    prisma.escalationRule.findMany({
      where: { active: true, trigger: { in: ["DRUM_NOT_IN_CURING", "TEST_OVERDUE", "TEST_FAILED", "PASSED_NO_REQUISITION"] } },
      orderBy: { level: "asc" },
      include: { recipients: { where: { active: true }, select: { name: true }, orderBy: { name: "asc" } } },
    }),
    // One query per team, so a long backlog of one team cannot push the others' drums out of the cap.
    ...kinds.map((k) =>
      prisma.drum.findMany({
        where: { ...scope, status: { in: openStatuses.filter((s) => kindOf(s) === k) } },
        orderBy: { unloadedAt: { sort: "asc", nulls: "last" } },
        take: CAP,
        include: {
          line: { select: { name: true } },
          product: { select: { code: true } },
          // Latest cycle and its latest test, picked the way the rules engine picks them.
          curingLogs: {
            orderBy: [{ cycleNo: "desc" }, { curingStartAt: "desc" }],
            take: 1,
            include: {
              hotSetTests: { orderBy: [{ testedAt: "desc" }, { createdAt: "desc" }], take: 1 },
              requisition: { include: { _count: { select: { curingLogs: true } } } },
            },
          },
        },
      }),
    ),
  ]);
  const drums = perKind.flat();

  const ids = drums.flatMap((d) => {
    const log = d.curingLogs[0];
    return [d.id, ...(log ? [log.id, ...log.hotSetTests.map((t) => t.id)] : [])];
  });
  const escalations = ids.length
    ? await prisma.escalation.findMany({
        where: { resolvedAt: null, firedAt: { not: null }, objectId: { in: ids } },
        select: { trigger: true, objectId: true, level: true, firedAt: true },
      })
    : [];
  const rulesOf = (trigger: AlertTrigger) => rules.filter((r) => r.trigger === trigger);
  const responsibleOf = (kind: Kind) => rulesOf(OWNER[kind])[0]?.recipients.map((p) => p.name) ?? [];

  const cards = drums
    .map((d) => {
      const log = d.curingLogs[0] ?? null;
      const test = log?.hotSetTests[0] ?? null;
      const req = log?.requisition && log.requisition.status !== "CANCELLED" ? log.requisition : null;
      const a = nextAction(
        d,
        log && {
          curingStartAt: log.curingStartAt,
          curingEndAt: log.curingEndAt,
          plannedCuringHrs: log.plannedCuringHrs == null ? null : Number(log.plannedCuringHrs),
          testDueAt: log.testDueAt,
          testedAt: test?.testedAt ?? null,
          requisitionRaisedAt: req?.raisedAt ?? null,
        },
        now,
        settings,
      );
      // The alert that watches this card, with the object and anchors services/rules/run.ts gives it.
      const watch: { trigger: AlertTrigger; objectId: string } | null =
        a.action === "load"
          ? { trigger: "DRUM_NOT_IN_CURING", objectId: d.id }
          : a.action === "test" && log
            ? { trigger: "TEST_OVERDUE", objectId: log.id }
            : a.action === "requisition" && log
              ? { trigger: "PASSED_NO_REQUISITION", objectId: log.id }
              : d.status === "FAILED" && test
                ? { trigger: "TEST_FAILED", objectId: test.id }
                : null;
      const fired = watch ? escalations.filter((e) => e.trigger === watch.trigger && e.objectId === watch.objectId) : [];
      // Someone has already been informed: the card is late whatever the clock says (e.g. passed, no requisition).
      const tone = fired.length ? ("red" as const) : a.tone;
      // The engine only alerts for drums unloaded after the alerts start date, so only those get a "next" line.
      const alertable = !!settings.alertsEnabledFrom && (d.unloadedAt ?? istDayStart(d.unloadDate)) >= settings.alertsEnabledFrom;
      const ladder =
        watch && (tone === "red" || fired.length)
          ? ladderLevels(
              rulesOf(watch.trigger),
              fired,
              { FROM_UNLOAD: d.unloadedAt, FROM_TEST_DUE: log?.testDueAt, FROM_EVENT: watch.trigger === "TEST_OVERDUE" ? log?.testDueAt : test?.createdAt },
              alertable,
            )
          : [];
      return { d, log, req, a: { ...a, tone }, ladder };
    })
    .sort(
      (x, y) =>
        TONE_ORDER[x.a.tone] - TONE_ORDER[y.a.tone] ||
        (x.a.deadline?.getTime() ?? Infinity) - (y.a.deadline?.getTime() ?? Infinity) ||
        (x.a.since?.getTime() ?? Infinity) - (y.a.since?.getTime() ?? Infinity),
    );

  const button = ({ d, log, req, a }: (typeof cards)[number]) => {
    if (a.action === "none") return null;
    const act = ACTIONS[a.action];
    if (!can(user, act.perm)) return null;
    if (a.action === "load") return <Link href={`/curing/new${qs({ drum: d.id })}`} className={BIG_BTN}><Bi text={act.button} stack /></Link>;
    if (!log) return null;
    if (a.action === "endCuring") return <Link href={`/curing/${log.id}/end`} className={BIG_BTN}><Bi text={act.button} stack /></Link>;
    if (a.action === "test") return <Link href={`/tests/new${qs({ log: log.id })}`} className={BIG_BTN}><Bi text={act.button} stack /></Link>;
    if (a.action === "requisition")
      return (
        <ActionForm action={raiseRequisition} submit={act.button} confirm={`Raise a requisition for drum ${d.drumNo}?`} className={BIG_FORM}>
          <input type="hidden" name="ids" value={log.id} />
        </ActionForm>
      );
    if (!req || req.status !== "RAISED") return null;
    const n = req._count.curingLogs;
    return (
      <ActionForm
        action={markDispatched}
        submit={act.button}
        confirm={`Mark requisition ${req.reqNo} as dispatched? This sends the whole requisition: ${n === 1 ? "this drum only" : `all ${n} drums on it, not only drum ${d.drumNo}`}.`}
        className={BIG_FORM}
      >
        <input type="hidden" name="id" value={req.id} />
      </ActionForm>
    );
  };
  const card = (c: (typeof cards)[number]) => (
    <li key={c.d.id}>
      <DrumCard
        drum={{ id: c.d.id, drumNo: c.d.drumNo, line: c.d.line.name, lengthM: c.d.lengthM, party: c.d.party, coreItem: c.d.coreItem, product: c.d.product }}
        action={c.a}
        actionText={c.a.action === "none" ? (STATUS[c.d.status]?.label ?? c.d.status) : ACTIONS[c.a.action].text}
        now={now}
        responsible={responsibleOf(c.a.kind)}
        ladder={c.ladder}
      >
        {button(c)}
      </DrumCard>
    </li>
  );
  const red = cards.filter((c) => c.a.tone === "red");
  const amber = cards.filter((c) => c.a.tone === "amber");
  const green = cards.filter((c) => c.a.tone === "green");

  // --- Management strip ---------------------------------------------------------------------
  const stat = (...statuses: DrumStatus[]) => {
    const g = byStatus.filter((b) => statuses.includes(b.status));
    return { drums: g.reduce((s, b) => s + b._count._all, 0), m: g.reduce((s, b) => s + Number(b._sum.lengthM ?? 0), 0) };
  };
  const onTime = compliance(
    unloadedToday.map((d) => ({ unloadedAt: d.unloadedAt, curingStartAt: d.curingLogs[0]?.curingStartAt ?? null, dataError: d.status === "DATA_ERROR" })),
    now,
    settings.curingStartLimitHours,
  );
  const late = stat("MISSING").drums;
  const overdue = stat("TEST_OVERDUE").drums;
  const waiting = stat("PASSED", "REQUISITION_RAISED");
  const tiles = [
    { label: `समय पर / On time today (${settings.curingStartLimitHours} h)`, value: onTime.pct == null ? "–" : fmtPct(onTime.pct), sub: onTime.pct == null ? "nothing due yet" : `${onTime.onTime} of ${onTime.due}`, href: "/office", bad: onTime.pct != null && onTime.pct < 100 },
    { label: "देर / Late now", value: late, sub: "not in tank", href: `/drums${qs({ status: "MISSING" })}`, bad: late > 0 },
    { label: "Test overdue", value: overdue, sub: "drums", href: `/drums${qs({ status: "TEST_OVERDUE" })}`, bad: overdue > 0 },
    { label: "Polypark के लिए / For Polypark", value: fmtKm(waiting.m), sub: `${waiting.drums} passed, not sent`, href: "/transfers", bad: false },
    { label: "Pass rate (30 d)", value: fmtPct(passRate(tests.map((t) => t.result))), sub: `${tests.length} first tests`, href: "/tests", bad: false },
  ];
  const openTotal = openStatuses.filter((s) => view === "all" || kindOf(s) === view).reduce((s, st) => s + stat(st).drums, 0);

  const heading = (text: string, n: number, dot: string) => (
    <h2 className="mb-3 flex items-center gap-2.5 text-lg font-semibold text-slate-900">
      <span className={`size-3 shrink-0 rounded-full ${dot}`} aria-hidden />
      <Bi text={text} />
      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-slate-700">{n}</span>
    </h2>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          <Bi text={L.home} stack />
        </h1>
        <Tour />
      </div>

      <section aria-label="Today in numbers" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`block rounded-lg border bg-white p-3 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-blue-700 ${t.bad ? "border-red-300" : "border-slate-200"}`}>
            <div className="text-xs font-medium text-slate-600"><Bi text={t.label} /></div>
            <div className={`text-2xl font-bold tabular-nums ${t.bad ? "text-red-700" : "text-slate-900"}`}>{t.value}</div>
            <div className="text-xs text-slate-600">{t.sub}</div>
          </Link>
        ))}
        <Link href="/office" className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-3 text-center text-sm font-medium text-blue-700 underline hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-blue-700">
          <Bi text="पूरा हिसाब / Office details" stack />
        </Link>
      </section>

      <nav aria-label="Team" className="flex gap-2 overflow-x-auto pb-1">
        {VIEWS.map((v) => (
          <Link
            key={v.view}
            href={`/${qs({ view: v.view })}`}
            aria-current={v.view === view ? "page" : undefined}
            className={`flex min-h-12 shrink-0 items-center rounded-full border px-5 text-base font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
              v.view === view ? "border-blue-700 bg-blue-700 text-(--on-solid)" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
            }`}
          >
            <Bi text={v.label} />
          </Link>
        ))}
      </nav>

      {cards.length < openTotal && (
        <p className="text-sm text-slate-600">
          Showing {cards.length} of {openTotal} open drums (the oldest unloads first). <Link href="/drums" className="font-medium text-blue-700 underline">See all drums</Link>
        </p>
      )}

      {cards.length > 0 && red.length + amber.length === 0 && (
        <div role="status" className="rounded-xl border border-green-300 bg-green-50 p-6 text-center text-green-900">
          <div className="text-2xl font-bold">
            <span aria-hidden>✓ </span>
            {L.allOk}
          </div>
          <p className="mt-1 text-base">अभी कोई काम देर से नहीं है। / Nothing is late or due soon right now.</p>
        </div>
      )}

      {red.length > 0 && (
        <section>
          {heading(L.actNow, red.length, "bg-red-600")}
          <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{red.map(card)}</ul>
        </section>
      )}
      {amber.length > 0 && (
        <section>
          {heading(L.dueSoon, amber.length, "bg-amber-500")}
          <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{amber.map(card)}</ul>
        </section>
      )}
      {green.length > 0 ? (
        // Folded away so the urgent cards are not buried; opening it shows the drums that are on time.
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="flex min-h-14 cursor-pointer items-center gap-2.5 px-4 text-lg font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700">
            <span className="size-3 shrink-0 rounded-full bg-green-600" aria-hidden />
            <Bi text={L.allOk} /> <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-slate-700">{green.length}</span>
            <span className="ml-auto text-sm font-medium text-blue-700 underline">खोलें / Show</span>
          </summary>
          <div className="space-y-3 p-3">
            <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{green.slice(0, GREEN_SHOWN).map(card)}</ul>
            {green.length > GREEN_SHOWN && (
              <p className="text-sm text-slate-600">
                and {green.length - GREEN_SHOWN} more that are on time. <Link href="/drums" className="font-medium text-blue-700 underline">See all drums</Link>
              </p>
            )}
          </div>
        </details>
      ) : (
        cards.length === 0 && <EmptyState>कोई खुला ड्रम नहीं / No open drums for this team</EmptyState>
      )}
    </div>
  );
}

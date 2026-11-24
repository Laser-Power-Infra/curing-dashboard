// Masters & Settings (guide 6.10, 3.13). Everyone signed in can read; each form needs its own permission.
import type { ReactNode } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, requireUser, type SessionUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fmtDateTime, fmtDuration, toIstInput } from "@/lib/format";
import { Banner, Card, Chip, EmptyState, Field, Input, PageHeader, Select, StatusChip, Textarea } from "@/components/ui";
import { Role } from "@/generated/prisma/enums";
import { TRIGGER_LABEL } from "../alerts/labels";
import { ActionForm } from "./action-form";
import { approveRecipe, saveEscalationRule, savePerson, saveRecipe, saveSettings, saveShift, saveUnit, saveUser, setRecipeState, setTestMode } from "./actions";

const TABS = [
  { key: "general", label: "Settings" },
  { key: "escalation", label: "Escalation matrix" },
  { key: "people", label: "People" },
  { key: "recipes", label: "Recipes" },
  { key: "users", label: "Users" },
  { key: "units", label: "Tanks & boilers" },
];
const ROLE_LABEL: Record<Role, string> = {
  MD: "MD", PRODUCTION_HEAD: "Production head", CURING: "Curing team", LAB: "Lab", BOILER: "Boiler",
  PLANNING: "Planning", TRANSFER: "Transfer", ADMIN: "Admin", VIEWER: "Viewer",
};

function Check({ name, value, label, defaultChecked }: { name: string; value?: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="size-5" />
      {label}
    </label>
  );
}

/** One row of a master list: the summary is always readable, the form opens only for people who may edit. */
function Item({ summary, editable, children }: { summary: ReactNode; editable: boolean; children?: ReactNode }) {
  const row = "flex min-h-11 flex-wrap items-center gap-2 px-3 py-2 text-sm";
  if (!editable) return <div className={`${row} border-t border-slate-100 first:border-t-0`}>{summary}</div>;
  return (
    <details className="border-t border-slate-100 first:border-t-0">
      <summary className={`${row} cursor-pointer hover:bg-slate-50`}>{summary}<span className="ml-auto text-xs text-blue-700 underline">Edit</span></summary>
      <div className="border-t border-slate-100 bg-slate-50 p-3">{children}</div>
    </details>
  );
}
const List = ({ children }: { children: ReactNode }) => <div className="rounded-lg border border-slate-200 bg-white">{children}</div>;
const Add = ({ label, children }: { label: string; children: ReactNode }) => (
  <details className="mb-4 rounded-lg border border-slate-200 bg-white">
    <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-blue-700">+ {label}</summary>
    <div className="border-t border-slate-100 p-3">{children}</div>
  </details>
);
const Grid = ({ children }: { children: ReactNode }) => <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
const Id = ({ id }: { id: string }) => <input type="hidden" name="id" value={id} />;
const Limits = ({ edit, children }: { edit: boolean; children: ReactNode }) =>
  edit ? <ActionForm action={saveSettings} submit="Save settings">{children}</ActionForm> : <>{children}</>;
const NoEdit =({ who }: { who: string }) => <p className="mb-3 text-sm text-slate-600">You can read this page. Only {who} can change it.</p>;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "general";
  return (
    <>
      <PageHeader title="Settings" sub="Limits, shift timings, who gets which alert, people, recipes and users. Every change is recorded." />
      <nav aria-label="Settings sections" className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap ${t.key === tab ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "general" && <General user={user} />}
      {tab === "escalation" && <Escalation user={user} />}
      {tab === "people" && <People user={user} />}
      {tab === "recipes" && <Recipes user={user} />}
      {tab === "users" && <Users user={user} />}
      {tab === "units" && <Units user={user} />}
    </>
  );
}

async function General({ user }: { user: SessionUser }) {
  const [s, shifts] = await Promise.all([getSettings(), prisma.shiftDef.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })]);
  const edit = can(user, "settings");
  const hours: [string, string, number, string][] = [
    ["rules.curingStartLimitHours", "Curing start limit (hours)", s.curingStartLimitHours, "A drum must be in curing within this many hours of unload."],
    ["rules.testOverdueGraceHours", "Test overdue after (hours)", s.testOverdueGraceHours, "No result this long after the test is due = Test overdue."],
    ["rules.curingLogSilenceHours", "Curing log silence (hours)", s.curingLogSilenceHours, "No new curing entry for this long while a line runs = alert."],
    ["rules.lineRunningWindowHours", "Line running window (hours)", s.lineRunningWindowHours, "A line counts as running if a drum was unloaded within this time."],
    ["data.staleFeedHours", "Drum feed is old after (hours)", s.staleFeedHours, "Shows the data warning when the drum feed is older than this."],
  ];
  return (
    <div className="grid gap-4">
      {!edit && <NoEdit who="an Admin" />}
      <Card title="Test mode">
        {s.testMode ? (
          <>
            <p className="mb-3 text-sm text-slate-800"><Chip tone="amber">Test mode is ON</Chip> WhatsApp alerts go only to the test numbers below and are labelled [TEST].</p>
            {edit && (
              <ActionForm
                action={setTestMode}
                submit="Switch test mode OFF"
                variant="danger"
                confirm="Switch test mode OFF? From now on the dashboard sends REAL WhatsApp messages to plant staff and the MD. The MD must have approved this first."
              >
                <input type="hidden" name="mode" value="off" />
                <Banner tone="red">
                  Switching test mode OFF sends <strong>real WhatsApp messages to plant staff and the MD</strong>. The MD must see the test results and approve this first.
                </Banner>
                <Check name="mdApproved" label="The MD has approved switching on live WhatsApp alerts" />
              </ActionForm>
            )}
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-800"><Chip tone="green">Live</Chip> WhatsApp alerts go to plant staff and the MD.</p>
            {edit && (
              <ActionForm action={setTestMode} submit="Switch test mode ON" variant="secondary">
                <input type="hidden" name="mode" value="on" />
              </ActionForm>
            )}
          </>
        )}
      </Card>

      <Card title="Limits and alerts">
        {/* Without the permission the same fields are shown, disabled and with no save button. */}
        <Limits edit={edit}>
          <fieldset disabled={!edit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hours.map(([key, label, value, hint]) => (
              <Field key={key} id={key} label={label} hint={hint}>
                <Input id={key} name={key} type="number" inputMode="decimal" step="0.25" min="0.25" max="720" required defaultValue={value} />
              </Field>
            ))}
            <Field id="ui.ageingBucketsHours" label="Ageing buckets (hours)" hint="Rising numbers with commas, e.g. 24, 48, 72.">
              <Input id="ui.ageingBucketsHours" name="ui.ageingBucketsHours" required defaultValue={s.ageingBucketsHours.join(", ")} />
            </Field>
            <Field id="alerts.maxSendAttempts" label="Send attempts before Failed" hint="How many times a WhatsApp message is tried.">
              <Input id="alerts.maxSendAttempts" name="alerts.maxSendAttempts" type="number" inputMode="numeric" step="1" min="1" max="10" required defaultValue={s.maxSendAttempts} />
            </Field>
            <Field id="alerts.enabledFrom" label="Alerts start from (IST)" hint="Only drums unloaded on or after this create alerts. Blank = no alerts at all.">
              <Input id="alerts.enabledFrom" name="alerts.enabledFrom" type="datetime-local" defaultValue={toIstInput(s.alertsEnabledFrom)} />
            </Field>
            <Field id="alerts.testNumbers" label="Test WhatsApp numbers" hint="One per line, with + and country code, e.g. +917001275745. Used while test mode is on.">
              <Textarea id="alerts.testNumbers" name="alerts.testNumbers" rows={3} defaultValue={s.testNumbers.join("\n")} />
            </Field>
          </fieldset>
        </Limits>
      </Card>

      <Card title="Shift timings (IST)">
        {shifts.some((x) => !x.confirmed) && <Banner>Some shift timings are not confirmed by the plant yet.</Banner>}
        <List>
          {shifts.map((x) => (
            <Item key={x.id} editable={edit} summary={<><strong>{x.name}</strong> {x.startTime}–{x.endTime} <Chip tone={x.confirmed ? "green" : "amber"}>{x.confirmed ? "Confirmed" : "Not confirmed"}</Chip></>}>
              <ActionForm action={saveShift} submit="Save shift">
                <Id id={x.id} />
                <Grid>
                  <Field id={`s-${x.id}`} label="Start (HH:mm)"><Input id={`s-${x.id}`} name="startTime" type="time" required defaultValue={x.startTime} /></Field>
                  <Field id={`e-${x.id}`} label="End (HH:mm)" hint="The night shift may end the next morning."><Input id={`e-${x.id}`} name="endTime" type="time" required defaultValue={x.endTime} /></Field>
                  <Check name="confirmed" label="Timings confirmed by the plant" defaultChecked={x.confirmed} />
                </Grid>
              </ActionForm>
            </Item>
          ))}
        </List>
      </Card>
    </div>
  );
}

async function Escalation({ user }: { user: SessionUser }) {
  const [rules, persons] = await Promise.all([
    prisma.escalationRule.findMany({ include: { recipients: true }, orderBy: [{ trigger: "asc" }, { level: "asc" }] }),
    prisma.person.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const edit = can(user, "settings");
  if (!rules.length) return <EmptyState>No escalation levels are set up yet.</EmptyState>;
  return (
    <>
      {!edit && <NoEdit who="an Admin" />}
      <List>
        {rules.map((r) => (
          <Item
            key={r.id}
            editable={edit}
            summary={
              <>
                <strong>{TRIGGER_LABEL[r.trigger]}</strong> <Chip tone="blue">Level {r.level}</Chip>
                <span>{r.delayMinutes ? `after ${fmtDuration(r.delayMinutes / 60)}` : "immediately"} → {r.recipients.map((p) => p.name).join(", ") || "nobody"}</span>
                {!r.active && <Chip>Off</Chip>}
              </>
            }
          >
            <ActionForm action={saveEscalationRule} submit="Save level">
              <Id id={r.id} />
              <Grid>
                <Field id={`d-${r.id}`} label="Delay (hours)" hint="0 = immediately. Counted from the unload, the test due time, the event or the shift end.">
                  <Input id={`d-${r.id}`} name="delayHours" type="number" inputMode="decimal" step="0.25" min="0" max="720" required defaultValue={r.delayMinutes / 60} />
                </Field>
                <Field id={`t-${r.id}`} label="Description"><Input id={`t-${r.id}`} name="description" required defaultValue={r.description} /></Field>
                <Check name="active" label="This level is on" defaultChecked={r.active} />
              </Grid>
              <fieldset className="mt-2">
                <legend className="text-sm font-medium text-slate-800">Who gets the message</legend>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                  {persons.map((p) => (
                    <Check key={p.id} name="recipients" value={p.id} label={p.whatsapp ? p.name : `${p.name} (no WhatsApp number)`} defaultChecked={r.recipients.some((x) => x.id === p.id)} />
                  ))}
                </div>
              </fieldset>
            </ActionForm>
          </Item>
        ))}
      </List>
    </>
  );
}

function PersonFields({ p }: { p?: { id: string; name: string; role: string | null; whatsapp: string | null; email: string | null; active: boolean } }) {
  const k = p?.id ?? "new";
  return (
    <Grid>
      {p && <Id id={p.id} />}
      <Field id={`n-${k}`} label="Name"><Input id={`n-${k}`} name="name" required defaultValue={p?.name} /></Field>
      <Field id={`r-${k}`} label="Role"><Input id={`r-${k}`} name="role" defaultValue={p?.role ?? ""} /></Field>
      <Field id={`w-${k}`} label="WhatsApp number" hint="With + and country code, e.g. +917001275745.">
        <Input id={`w-${k}`} name="whatsapp" type="tel" pattern="\+\d{10,15}" defaultValue={p?.whatsapp ?? ""} />
      </Field>
      <Field id={`m-${k}`} label="Email"><Input id={`m-${k}`} name="email" type="email" defaultValue={p?.email ?? ""} /></Field>
      {p && <Check name="active" label="Active (gets alerts)" defaultChecked={p.active} />}
    </Grid>
  );
}

async function People({ user }: { user: SessionUser }) {
  const persons = await prisma.person.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  const edit = can(user, "masters");
  return (
    <>
      {!edit && <NoEdit who="the production head, planning or an Admin" />}
      {edit && <Add label="Add a person"><ActionForm reset action={savePerson} submit="Add person"><PersonFields /></ActionForm></Add>}
      {!persons.length ? <EmptyState>No people yet.</EmptyState> : (
        <List>
          {persons.map((p) => (
            <Item
              key={p.id}
              editable={edit}
              summary={<><strong>{p.name}</strong><span className="text-slate-600">{p.role ?? "–"}</span>{p.whatsapp ? <span className="tabular-nums">{p.whatsapp}</span> : <Chip tone="amber">No WhatsApp number</Chip>}{!p.active && <Chip>Inactive</Chip>}</>}
            >
              <ActionForm action={savePerson} submit="Save person"><PersonFields p={p} /></ActionForm>
            </Item>
          ))}
        </List>
      )}
    </>
  );
}

async function Recipes({ user }: { user: SessionUser }) {
  const [recipes, products] = await Promise.all([
    prisma.curingRecipe.findMany({ include: { product: true }, orderBy: [{ status: "asc" }, { compound: "asc" }] }),
    prisma.product.findMany({ where: { active: true, isCuringItem: true }, orderBy: { name: "asc" } }),
  ]);
  const edit = can(user, "masters");
  const approve = can(user, "approveRecipe");
  const fields = (r?: (typeof recipes)[number]) => {
    const k = r?.id ?? "new";
    return (
      <Grid>
        {r && <Id id={r.id} />}
        <Field id={`c-${k}`} label="Compound"><Input id={`c-${k}`} name="compound" required defaultValue={r?.compound} /></Field>
        <Field id={`p-${k}`} label="Product">
          <Select id={`p-${k}`} name="productId" required defaultValue={r?.productId ?? ""}>
            <option value="">Choose…</option>
            {r && !products.some((p) => p.id === r.productId) && <option value={r.productId}>{r.product.name}</option>}
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field id={`y-${k}`} label="Curing type" hint="For example Tank, Autoclave, Steam."><Input id={`y-${k}`} name="curingType" required defaultValue={r?.curingType} /></Field>
        <Field id={`h-${k}`} label="Approved curing hours">
          <Input id={`h-${k}`} name="approvedCuringHrs" type="number" inputMode="decimal" step="0.25" min="0.25" max="999" required defaultValue={r?.approvedCuringHrs.toString()} />
        </Field>
        <Field id={`w-${k}`} label="Wait before test (hours)">
          <Input id={`w-${k}`} name="waitBeforeTestHrs" type="number" inputMode="decimal" step="0.25" min="0" max="999" required defaultValue={r?.waitBeforeTestHrs.toString()} />
        </Field>
        <Field id={`k-${k}`} label="Remarks"><Input id={`k-${k}`} name="remarks" defaultValue={r?.remarks ?? ""} /></Field>
      </Grid>
    );
  };
  return (
    <>
      <Banner tone="blue">
        The rules only use recipes that are both <strong>Approved</strong> and <strong>in use</strong>. A new or changed recipe is a Draft until the production head approves it.
      </Banner>
      {!edit && <NoEdit who="the production head, planning or an Admin" />}
      {edit && <Add label="Add a draft recipe"><ActionForm reset action={saveRecipe} submit="Add draft recipe">{fields()}</ActionForm></Add>}
      {!recipes.length ? <EmptyState>No recipes yet. Until one is approved, curing entries show &quot;No recipe&quot;.</EmptyState> : (
        <List>
          {recipes.map((r) => (
            <Item
              key={r.id}
              editable={edit || approve}
              summary={
                <>
                  <StatusChip status={r.status} /> <Chip tone={r.inUse ? "green" : "grey"}>{r.inUse ? "In use" : "Not in use"}</Chip>
                  <strong>{r.compound}</strong><span>{r.product.name}</span>
                  <span className="text-slate-600">{r.curingType} · cure {fmtDuration(r.approvedCuringHrs)} · wait {fmtDuration(r.waitBeforeTestHrs)}</span>
                </>
              }
            >
              {r.approvedAt && <p className="mb-3 text-xs text-slate-600">Approved {fmtDateTime(r.approvedAt)} by {r.approvedBy ?? "–"}</p>}
              {edit && (
                <ActionForm action={saveRecipe} submit="Save recipe" confirm={r.status === "APPROVED" ? "If you change the compound, product, curing type or hours, this recipe goes back to Draft and the rules stop using it until the production head approves it again. Save?" : undefined}>
                  {fields(r)}
                  {r.status === "APPROVED" && <p className="mt-2 text-sm text-amber-900">Changing the compound, product, curing type or hours puts this recipe back to Draft. It then needs approval again.</p>}
                </ActionForm>
              )}
              <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-200 pt-3">
                {r.status === "DRAFT" && (approve ? (
                  <ActionForm action={approveRecipe} submit="Approve recipe" className="[&>div]:mt-0" confirm="Approve this recipe? The rules will use its hours from now on."><Id id={r.id} /></ActionForm>
                ) : <p className="text-sm text-slate-600">Waiting for the production head to approve.</p>)}
                {edit && (
                  <ActionForm action={setRecipeState} submit={r.inUse ? "Take out of use" : "Put in use"} variant="secondary" className="[&>div]:mt-0">
                    <Id id={r.id} /><input type="hidden" name="what" value={r.inUse ? "unuse" : "use"} />
                  </ActionForm>
                )}
                {edit && r.status !== "RETIRED" && (
                  <ActionForm action={setRecipeState} submit="Retire recipe" variant="secondary" className="[&>div]:mt-0" confirm="Retire this recipe? The rules will stop using it.">
                    <Id id={r.id} /><input type="hidden" name="what" value="retire" />
                  </ActionForm>
                )}
              </div>
            </Item>
          ))}
        </List>
      )}
    </>
  );
}

async function Users({ user }: { user: SessionUser }) {
  const users = await prisma.user.findMany({ orderBy: [{ active: "desc" }, { email: "asc" }] });
  const edit = can(user, "settings");
  const fields = (u?: (typeof users)[number]) => {
    const k = u?.id ?? "new";
    return (
      <>
        <Grid>
          {u ? <Id id={u.id} /> : <Field id="u-email" label="Company email"><Input id="u-email" name="email" type="email" required /></Field>}
          <Field id={`un-${k}`} label="Name"><Input id={`un-${k}`} name="name" defaultValue={u?.name ?? ""} /></Field>
          {u && <Check name="active" label="Active (can sign in)" defaultChecked={u.active} />}
        </Grid>
        <fieldset className="mt-2">
          <legend className="text-sm font-medium text-slate-800">Roles</legend>
          <div className="grid grid-cols-2 lg:grid-cols-3">
            {Object.values(Role).map((r) => <Check key={r} name="roles" value={r} label={ROLE_LABEL[r]} defaultChecked={u?.roles.includes(r)} />)}
          </div>
        </fieldset>
      </>
    );
  };
  return (
    <>
      <p className="mb-3 text-sm text-slate-600">Anyone with a company Google account can sign in and read. Add them here to give them a role.</p>
      {!edit && <NoEdit who="an Admin" />}
      {edit && <Add label="Add a user"><ActionForm reset action={saveUser} submit="Add user">{fields()}</ActionForm></Add>}
      {!users.length ? <EmptyState>No users yet.</EmptyState> : (
        <List>
          {users.map((u) => (
            <Item
              key={u.id}
              editable={edit}
              summary={<><strong className="break-all">{u.email}</strong>{u.name && <span className="text-slate-600">{u.name}</span>}{u.roles.map((r) => <Chip key={r} tone="blue">{ROLE_LABEL[r]}</Chip>)}{!u.roles.length && <Chip>Viewer</Chip>}{!u.active && <Chip tone="red">Inactive</Chip>}</>}
            >
              <ActionForm action={saveUser} submit="Save user">{fields(u)}</ActionForm>
            </Item>
          ))}
        </List>
      )}
    </>
  );
}

async function Units({ user }: { user: SessionUser }) {
  const [units, boilers] = await Promise.all([prisma.curingUnit.findMany({ orderBy: { code: "asc" } }), prisma.boiler.findMany({ orderBy: { code: "asc" } })]);
  const edit = can(user, "masters");
  const rows = [...units.map((u) => ({ ...u, kind: u.type as string })), ...boilers.map((b) => ({ ...b, kind: "BOILER" }))];
  const KIND: Record<string, string> = { TANK: "Tank", AUTOCLAVE: "Autoclave", BOILER: "Boiler" };
  return (
    <>
      {!edit && <NoEdit who="the production head, planning or an Admin" />}
      {edit && (
        <Add label="Add a tank, autoclave or boiler">
          <ActionForm reset action={saveUnit} submit="Add">
            <Grid>
              <Field id="unit-kind" label="What is it">
                <Select id="unit-kind" name="kind" required>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              </Field>
              <Field id="unit-code" label="Code" hint="Short and fixed, e.g. ACL01 or UBL07."><Input id="unit-code" name="code" required /></Field>
              <Field id="unit-name" label="Name"><Input id="unit-name" name="name" required /></Field>
            </Grid>
          </ActionForm>
        </Add>
      )}
      {!rows.length ? <EmptyState>No tanks, autoclaves or boilers yet.</EmptyState> : (
        <List>
          {rows.map((u) => (
            <Item key={u.id} editable={edit} summary={<><Chip tone="blue">{KIND[u.kind]}</Chip><strong>{u.name}</strong><span className="text-slate-600">{u.code}</span>{!u.active && <Chip>Inactive</Chip>}</>}>
              <ActionForm action={saveUnit} submit="Save">
                <Id id={u.id} /><input type="hidden" name="kind" value={u.kind} />
                <Grid>
                  <Field id={`un-${u.id}`} label="Name"><Input id={`un-${u.id}`} name="name" required defaultValue={u.name} /></Field>
                  <Check name="active" label="Active" defaultChecked={u.active} />
                </Grid>
              </ActionForm>
            </Item>
          ))}
        </List>
      )}
    </>
  );
}

# Curing Dashboard – Build Guide

**Laser Power & Infra – Kharagpur plant · Sioplas 3 & 4 curing**
Prepared for: Asmita and the developer · Approval: Deepak Goel (MD) signs off before anything goes live
Based on: *Curing Automation – Developer Handover (Missing Drum Tracker & Dashboard)*, 23-Nov-2026
Version: 1.0 · 24-Nov-2026

---

## 0. How to read this guide

- **Section 1–2:** what we are building and the big decisions.
- **Section 3–4:** data model and where the data comes from.
- **Section 5:** business rules. Build these *exactly*. They come from the handover doc and were confirmed by the MD.
- **Section 6–8:** screens, UX and design standards.
- **Section 9–11:** alerts, background jobs, roles.
- **Section 12–15:** build rules, testing, rollout, open points.

Words in **MUST** are not optional. Anything marked **[CONFIG]** must be editable by an admin in the dashboard, not hard-coded.

---

## 1. What we are building

A new, professional web dashboard that becomes the **single place** where curing data for Sioplas 3 and Sioplas 4 is entered, checked, tracked and reported.

Every drum insulated on Sioplas 3 or 4 at Kharagpur must go into a curing tank / autoclave **within 6 hours of unloading**. The dashboard must:

1. Find every drum made but not yet entered in the Curing Log ("missing drums").
2. Keep a permanent track record of each missing / late drum until it is cured.
3. Send WhatsApp alerts and escalations when a time limit is crossed.
4. Show everything on one screen: **Made → In curing → Awaiting test → Test overdue → Failed → Passed → Sent to Polypark**.
5. Tell the transfer team to raise a requisition once drums pass the hot set test (Kharagpur → Polypark).

**Scope of this phase:** Kharagpur, **Sioplas 3 and Sioplas 4 only**. Sioplas 1 & 2 (Polypark lines) come in the Polypark phase. Design the data model so a new plant / line can be added later by configuration only.

### 1.1 Big change: the dashboard owns the data

From go-live, **the dashboard is the system of record**. Data is entered and maintained in the dashboard, not in Google Sheets.

| Before | After go-live |
|---|---|
| Curing Log, Hot Set Test, Boiler Temp Log kept in the Curing Sheet | Entered through dashboard forms and stored in the dashboard database |
| Masters (Recipe, Product, Person, Responsibility) in sheet tabs | Maintained on the dashboard's Masters pages |
| Missing drums found by hand | Found automatically every hour |
| Summary / Dashboard tabs built with sheet formulas | Live dashboard pages |
| Alerts sent ad hoc | Automatic, logged, with escalation |

The Google Sheets are imported **once** (Section 4.3), then kept **read-only** as history. If anyone still needs a sheet view, the dashboard can export to a sheet; data never flows back from the sheet.

---

## 2. Key decisions (decide before coding)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Where the dashboard lives | A new module inside the existing **SFG Dashboard** (laser-sfg.duckdns.org) so users keep one Google sign-in and one URL. If not possible, a separate app with the same Google sign-in. |
| D2 | Tech stack | **Decided:** Next.js (App Router, TypeScript) + **Neon Postgres** + **Prisma 7**. See Section 2A. |
| D3 | Background jobs | Run W1–W7 (Section 10) either as in-app scheduled jobs **or** as n8n workflows that call the dashboard API. Pick one and document it. Keep the existing W0 n8n workflow. |
| D4 | WhatsApp route | The **Urgent WhatsApp Message sheet** (Send Message tab) **or** a direct WhatsApp API. Asmita and the developer agree on one. Build it behind one "message sender" adapter so it can be switched later without changing the rules. |
| D5 | Unload time source | SFG Dashboard unload time (Puja to confirm it exists). If it doesn't, add an **Unload entry** form in this dashboard where the line operator records the unload date and time per drum. |
| D6 | Shift timings | Needed for per-shift compliance and boiler alerts. Store as **[CONFIG]**. Example only: Morning 06:00–14:00, Afternoon 14:00–22:00, Night 22:00–06:00. Plant to confirm. |

---

## 2A. Tech stack and project setup

| Layer | Choice | Notes |
|---|---|---|
| App | **Next.js 16** (App Router, TypeScript, Server Components + Server Actions) | Route handlers under `app/api/*` for jobs and integrations |
| Database | **Neon Postgres** | Use a `dev` branch for development and staging, and `main` for production. Neon branches make safe test copies (rule 12.1). |
| ORM | **Prisma 7** with the **Neon driver adapter** (`@prisma/adapter-neon`) | Prisma 7 needs `prisma.config.ts`, the `prisma-client` generator and a driver adapter |
| Auth | Google sign-in (Auth.js) restricted to the company domain | Roles from the `users` table |
| UI | Tailwind CSS + a component library (e.g. shadcn/ui), Recharts for charts | Follow Sections 7–8 |
| Jobs | Vercel Cron / n8n calling protected route handlers (`/api/jobs/w1` … `w7`) | Protect them with a `CURING_API_KEY` header |
| Hosting | Vercel (or any Node 22+ host) | Region close to the Neon region (Singapore / Mumbai) |

### Files provided (`curing-dashboard-db/`)

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | Full data model (Section 3). Validated with Prisma 7.10.1. |
| `seed/seed.ts` | Master and config data: plants, lines, shifts, boilers, persons, responsibilities, escalation matrix, settings, products. Idempotent. |
| `prisma.config.ts` | Prisma 7 config: schema path, migrations path, seed command, CLI connection |
| `lib/prisma.ts` | Prisma client singleton for Next.js (Neon adapter, pooled URL) |
| `.env.example` | Environment variables |

### Neon connection strings

- `DATABASE_URL` is the **pooled** string (host contains `-pooler`). The Next.js app uses it at runtime.
- `DIRECT_URL` is the **direct** (unpooled) string. The Prisma CLI uses it for `migrate`, `db seed` and `studio`.

### Setup steps

```bash
npx create-next-app@latest curing-dashboard --ts --app --tailwind --eslint --import-alias "@/*"
cd curing-dashboard
# copy in: prisma/, prisma.config.ts, lib/prisma.ts, .env.example (merge .gitignore)

npm i @prisma/client @prisma/adapter-neon dotenv
npm i -D prisma tsx

cp .env.example .env          # fill DATABASE_URL, DIRECT_URL, AUTH_SECRET
npx prisma validate           # check the schema
npx prisma migrate dev --name init   # creates tables on the Neon dev branch
npx prisma db seed            # loads master/config data
npx prisma studio             # optional: browse the data
```

Add to `package.json`:

```json
"scripts": {
  "postinstall": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:seed": "prisma db seed",
  "db:studio": "prisma studio"
}
```

Import the client in server code only: `import { prisma } from "@/lib/prisma";`. Generated types come from `@/generated/prisma/client`.

**Production:** run `prisma migrate deploy` in the deploy pipeline. **Never** run `migrate dev` against the `main` branch.

### What the seed does NOT load (import instead, Section 4.3)

Curing Recipe Master, Curing Log, Hot Set Test, Boiler Temp Log, Daily History and drums. These come from the Curing Sheet through the one-time import. The rules can't run until approved recipes exist.

---

## 3. Data model

The Prisma schema (`prisma/schema.prisma`) is the source of truth. The tables below describe it in plain words.

Every table has an `id` (cuid) and `createdAt` / `updatedAt`. Tables people edit also have `createdBy` / `updatedBy` (user email, or a job name such as `job:W2`). **No hard deletes**: rows are closed or cancelled with a status. Every edit goes to the audit log (3.14).

All times are stored in UTC and **shown in IST** (`24-Nov-26 14:30`).

### 3.1 `drums` – drums made (production entries)

One row per drum unloaded from Sioplas 3 / 4.

| Field | Type | Notes |
|---|---|---|
| grid_entry_id | text, unique | From the SFG Dashboard. Key for sync. |
| plant | text | `Kharagpur` |
| line | enum | `Sioplas 3`, `Sioplas 4` (configurable list) |
| unloaded_at | datetime | **Date and time.** Required for the 6-hour rule. |
| unload_time_source | enum | `SFG`, `Manual entry`, `Unknown` |
| prod_orders | text[] | One drum can carry more than one order (e.g. `P126Y-00308, P126Y-00790`). Store as a list. |
| mc_no | text | |
| party | text | |
| core_item | text | Core / conductor item |
| drum_no | text | Physical drum number. **Re-used**, so never unique. |
| drum_size | text | |
| length_m | number | |
| entered_by | text | |
| is_curing_item | boolean | False for items that are not cured (e.g. a compact conductor). From Product Master. |
| status | enum | Derived pipeline status (Section 5.9) |
| data_flags | text[] | e.g. `DUPLICATE_SAME_DAY`, `MISSING_PARTY`, `NOT_CURING_ITEM` |

### 3.2 `curing_log` – one row per drum per curing cycle

A drum that fails and is re-cured gets a **second** curing row.

| Field | Notes |
|---|---|
| lot_no | |
| drum_id | FK → drums (set by the matching rule, 5.3) |
| core_production_date | |
| product | FK → product master |
| core_drum_no | As written by the curing team |
| length_m | |
| xlpe_compound | |
| chamber_tank | Tank / autoclave |
| curing_start_at, curing_end_at | Date + time |
| planned_curing_hrs | From the recipe (auto-filled, read-only) |
| actual_curing_hrs | **Computed** = end − start |
| hours_deviation | **Computed** = actual − planned |
| time_check | **Computed**: `OK` / `Under-cured` |
| visual_check | `OK` / `Not OK` + note |
| test_due_at | **Computed** = curing_end_at + wait_before_test_hrs |
| test_result | **Derived** from Hot Set Test (5.6) |
| sent_date | Filled when dispatched |
| lot_status | Derived pipeline status |
| cycle_no | 1 = first curing, 2 = re-cure, … |
| remarks | Manual |
| md_remarks | Manual, MD only |

### 3.3 `hot_set_tests`

lot_no, drum_id / curing_log_id, sample_end, test_type, readings (JSON or fixed columns), hot_set_pct, permanent_set_pct, **result (`Pass` / `Fail`, entered by the lab)**, tested_at, tested_by, remarks.

### 3.4 `boiler_temp_log`

date, shift (`Morning` / `Afternoon` / `Night`), boiler, reading(s), recorded_at, recorded_by, remarks.

### 3.5 `curing_recipe_master`

compound + product + curing_type → approved_curing_hrs, wait_before_test_hrs, in_use (Yes/No), status (`Draft` / `Approved` / `Retired`). **Only `in_use = Yes` and `status = Approved` rows are used by the rules.** Changes need production head (Mukesh) approval.

### 3.6 `product_master`

product code, name, size, voltage, is_curing_item, default recipe, active.

### 3.7 `person_master` and `responsibility`

Person: name, role, WhatsApp number, email, active.
Responsibility: area → responsible person(s) (used for alerts).

Seed data (from the handover doc):

| Area | Responsible | WhatsApp |
|---|---|---|
| Curing Log (loading / unloading) | Kuntal Khanra | 7001275745 |
| Hot Set Test | Suvajit Kar | 8317833974 |
| Boiler Temp Log | Pravatranjan Pal | 8768444213 |
| Recipe / Person Master / Production head | Mukesh | 8252976559 |
| Product Master / planning | Kamlesh | 8961401145 |
| Transfer (requisition to Polypark) | Prasenjit (+ Mukesh, Kamlesh, Kuntal) | – (to be added) |
| MD | Deepak Goel | – (to be added) |

### 3.8 `missing_drum_tracker`

The permanent record. **Rows are never deleted, only closed.**

| Column | Who writes it |
|---|---|
| Track ID | Auto |
| Grid entry ID | Auto |
| Line | Auto |
| Drum no | Auto |
| Item | Auto |
| Prod Order | Auto |
| Length (m) | Auto |
| Unloaded at | Auto |
| Hours since unload | Auto (live) |
| Status: `Missing` / `Late` / `Cured` / `Data error` | Auto |
| Matched Curing Log row | Auto |
| Curing start | Auto |
| Hours late | Auto |
| Escalation level reached | Auto |
| Last alert sent at | Auto |
| Closed on | Auto |
| Reason: `Tank full`, `Boiler down`, `No manpower`, `Drum on hold`, `Other` | **Manual** |
| Remarks | **Manual** |
| MD Remarks | **Manual (MD only)** |

Automation writes **only** the auto columns. Manual columns are **never** overwritten.

### 3.9 `alerts` (Alert Log – audit trail)

One row per WhatsApp message: sent_at, trigger, drum(s) / lot(s), level, person, number, message text, message no / provider id, delivery status, error.

### 3.10 `escalations`

One row per (trigger, object, level): trigger type, object id (drum / curing row / test / boiler shift), level, due_at, fired_at, alert_id, resolved_at. This is what guarantees **one alert per drum per level**.

### 3.11 `requisitions` (transfer to Polypark)

requisition no, created_at, created_by, drums / curing rows included, total length (km), status (`Raised` / `Dispatched` / `Received`), dispatched_at (fills `sent_date`), remarks.

### 3.12 `daily_history`

One snapshot per day at 08:00 IST: counts per status, km per status, compliance %, pass rate, open escalations. Used for the 30-day trend. Import the existing Daily History tab on day one.

### 3.13 `settings`

Time limits, escalation timings, shift timings, sender route, MD number, quiet hours (if any). Everything in Sections 5 and 9 that is a number lives here.

### 3.14 `audit_log`

table, row id, field, old value, new value, changed_by, changed_at, source (`UI`, `Job W2`, `Import`, …).

---

## 4. Data sources and migration

### 4.1 Sources

| What | Source | How often |
|---|---|---|
| Drums made (Sioplas 3/4) | SFG Dashboard (Grid production / its replacement) via its pages or saved queries. **Never read Oracle directly.** | Every hour (W1) |
| Curing Log, Hot Set Test, Boiler log | Entered in this dashboard | Live |
| Masters | Maintained in this dashboard | As needed |
| Reference only | HT Cable Core Stock – Daily (`1KoWKT2_C6NWN7YB7wWmvezAbPQ1Sb82OCfHwxqsHvx0`), NEW KGP DAILY PRODUCTION (`104vRZsgMsOSe9m4-AJCifd-wZnQ946xF2Wo97DKEDsw`) | Not synced |

### 4.2 Known data gaps (as of 24-Nov-26)

Checked on the `Curing` tab of *Armouring 5 – SFG Dashboard Data* (77 drums, 8-Oct to 16-Nov-26):

| Gap | Impact | Handling in the build |
|---|---|---|
| **Unload time is blank** for every drum (date only) | The 6-hour rule can't run | Build with `unloaded_at` as date + time. If only a date is known, set `unload_time_source = Unknown`, show the drum with a grey "time unknown" badge, and **do not fire 6-hour alerts** for it. Add the manual Unload entry form (D5) as a fallback. |
| No entries after 16-Nov-26 (Grid no longer used) | New drums are not seen | W1 must read from the new source once Puja / Samrat confirm it. Show "Last sync" and "Latest drum entry" on screen so a stale feed is obvious. |
| Tab is a one-time copy; the Drum Register refreshes daily | Not hourly | W1 must pull hourly from the live source |
| Same drum no twice on the same day (drum 879, 14-Nov) | Matching ambiguity | Flag as `Data error` (rule 5.3) |
| A compact conductor row (Grid ID 331105) | Not a curing item | `is_curing_item = false` → exclude from rules |
| Two prod orders in one cell (3 rows) | | Split into the `prod_orders` list |
| MC No / Party blank (2 rows) | | Flag `MISSING_PARTY`, allow manual fill |
| "Curing ticked" is TRUE for all drums | Not reliable | **Do not use.** Only the matching rule decides if a drum is cured. |

### 4.3 One-time import (cut-over)

1. Import masters first: Recipe, Product, Person, Responsibility.
2. Import drums (Curing tab / Drum Register).
3. Import the Curing Log, Hot Set Test, Boiler Temp Log and Daily History from the Curing Sheet.
4. Run the matching rule over history and build the Missing Drum Tracker.
5. **Reconcile** against the Curing Sheet Summary. Counts must match. Snapshot on 23-Nov-26 14:30: 5 in curing, 9 awaiting test, 20 test overdue, 10 failed (hold / re-cure), 209 passed (ready to send), 125 sent, pass rate 92%.
6. Write an import report: rows read, imported, rejected (with reasons).
7. Make the sheets read-only and add a note at the top: *"Moved to the Curing Dashboard on <date>."*

**Historic drums must not trigger alerts.** Set `alerts_enabled_from` (date) in settings so only drums unloaded after go-live can create alerts.

---

## 5. Business rules (build exactly)

### 5.1 Rule 1 – 6-hour rule
A drum unloaded from Sioplas 3 or 4 **MUST** have a Curing Start in the Curing Log within **6 hours** of unload. Unload time = the unload time from the SFG Dashboard (or the manual Unload entry, D5).

### 5.2 Rule 2 – Missing and Late
- **Missing** = drum on Sioplas 3/4, `is_curing_item = true`, **no matching Curing Log row**, and **more than 6 hours** since unload.
- **Late** = matched, but curing started **after** 6 hours. Kept on record with `hours_late = curing_start − (unloaded_at + 6 h)`.
- **Cured** = matched and started within 6 hours.
- A Missing drum moves to `Late` (and closes) the moment its curing row is matched.

### 5.3 Rule 3 – Matching a drum to the Curing Log
Match on **Core Drum No and time**: the **first** Curing Log row for that drum no whose `curing_start_at` is **after** the drum's `unloaded_at`.

- Drum numbers are re-used, so **never match on drum no alone**. In the current data, 18 drum numbers appear on more than one date.
- The same drum no unloaded **twice on the same day** = `Data error`. Don't auto-match; show it in the "Needs attention" list for a person to resolve.
- A curing row can match **only one** drum. Once used, it is not offered to a later drum.
- If the next unload of the same drum no happens before any curing row, the earlier drum stays Missing. Never jump to a row that belongs to the later drum.

```
for drum in drums where line in (Sioplas 3, Sioplas 4) and is_curing_item and not closed:
    if another drum has same drum_no and same unload date: status = Data error; continue
    next_unload = earliest unloaded_at of same drum_no after this drum
    row = first curing_log where core_drum_no = drum.drum_no
                              and curing_start_at > drum.unloaded_at
                              and (next_unload is null or curing_start_at < next_unload)
                              and row not already matched
                              order by curing_start_at
    if row:   link; status = Cured if start <= unloaded_at + 6h else Late; close tracker row
    elif now > unloaded_at + 6h: status = Missing (open / update tracker row)
```

When a curing row is entered in the dashboard, **suggest** the matching drum (same rule) in the form, so the curing team links it at entry and doesn't need to type the drum number exactly.

### 5.4 Rule 4 – Curing time
`actual_curing_hrs` **MUST** be ≥ the recipe's `approved_curing_hrs` (only `in_use = Yes` and `status = Approved` recipes). Otherwise `time_check = Under-cured`, which raises an alert. If no approved recipe is found, flag "No recipe" and alert Mukesh.

### 5.5 Rule 5 – Test due and overdue
`test_due_at = curing_end_at + wait_before_test_hrs`.
No result **2 hours after** test_due_at → **Test overdue**.

### 5.6 Rule 6 – Result (MD rule)
Pass / Fail = the **Result entered in the Hot Set Test** record. The dashboard **does not recalculate** Pass/Fail from % limits; it may show the % values for reference only.
**Fail** → status `Failed – hold / re-cure`. The drum **cannot** be added to a requisition or marked sent. A re-cure creates a new curing cycle (cycle_no + 1) and a new test.

### 5.7 Rule 7 – Passed drums → transfer
On Pass, send a WhatsApp message to **Prasenjit, Mukesh, Kamlesh and Kuntal Khanra** saying the drums have passed and must be sent from Kharagpur to Polypark, with **lot no, drum no and length**. The transfer team raises a requisition in the dashboard. `sent_date` is filled once dispatched.

### 5.8 Rules 8–10
- **Rule 8 – Curing Log not updated:** a Sioplas line is running but there's no new Curing Log row for **4 hours** → alert Kuntal Khanra. "Running" = at least one drum unloaded on Sioplas 3/4 in the last 4 hours **[CONFIG]**, or a running signal from the SFG Dashboard if one is available.
- **Rule 9 – Boiler log:** a missing Morning / Afternoon / Night reading → alert Pravatranjan Pal at shift end.
- **Rule 10:** a drum stays on the Missing Drum Tracker until cured. Rows are never deleted, only closed.

### 5.9 Drum pipeline status (one status per drum, latest cycle)

| Order | Status | Condition |
|---|---|---|
| 1 | Made | Unloaded, not yet matched, within 6 h |
| 1a | Missing | Not matched, > 6 h since unload |
| 2 | In curing | Matched, curing started, no curing end |
| 3 | Awaiting test | Curing ended, no result, now ≤ test_due + 2 h |
| 4 | Test overdue | No result, now > test_due + 2 h |
| 5 | Failed – hold / re-cure | Latest result = Fail |
| 6 | Passed – ready to send | Latest result = Pass, not yet dispatched |
| 6a | Requisition raised | On an open requisition |
| 7 | Sent | Dispatched (sent_date set) |
| – | Data error | Matching conflict; needs a person |

Km figures: `sum(length_m) / 1000`, shown with 2 decimals.

### 5.10 6-hour compliance %
Per line, per day and per shift (by unload time):
`compliance % = drums cured within 6 h ÷ drums due (unloaded more than 6 h ago, curing items only, excluding Data error) × 100`.
Drums with an unknown unload time are excluded and shown as a separate count.

### 5.11 Pass rate
`passed ÷ (passed + failed)` for first-cycle tests in the period. Show the definition in the tooltip and match the Curing Sheet Summary definition during the parallel run.

---

## 6. Screens

All screens share one layout: a top bar (logo, plant / line filter, global search by drum no / lot no / grid ID, "Last sync" time, user menu) and a left navigation that becomes a bottom tab bar on mobile.

### 6.1 Overview (home)
Built for the MD on a phone first.

- **KPI strip:** Missing now · In curing · Awaiting test · Test overdue · Failed · Passed – ready to send · Sent (today / this week). Each shows drums **and km**. Tapping a tile opens the filtered list.
- **Pipeline bar:** Made → In curing → Awaiting test → Test overdue → Failed → Passed → Sent, drums and km.
- **Missing drums now:** a red list by line, with hours since unload, escalation level and the person responsible. Most overdue first.
- **6-hour compliance:** today and yesterday per line, plus per shift.
- **Open escalations** by person and level.
- **Data health banner:** shown when the drum feed is older than 2 hours, when unload times are missing, or when Data errors exist.

### 6.2 Missing Drum Tracker
- Table with every column from 3.8, with tabs **Open (Missing)** · **Late** · **Data error** · **Closed** · **All**.
- Filters: line, date range, status, reason, escalation level, person.
- The Reason dropdown, Remarks and MD Remarks can be edited inline (MD Remarks for the MD only). Changes save automatically and show a "Saved" tick.
- Row click opens the **Drum detail** drawer (6.3).
- Export to Excel / CSV.

### 6.3 Drum detail (drawer / page)
- A timeline for one drum: Unloaded → Curing start → Curing end → Test due → Result → Requisition → Sent, each with time, person and hours taken. A red marker shows any step that broke a limit.
- All curing cycles, tests, alerts sent and audit history for that drum.
- Actions, depending on role: link to a curing row, mark as a non-curing item, add remarks.

### 6.4 Curing Log
- **"New curing entry" form** (mobile-friendly, for the curing team):
  - Choose the drum from a searchable list of drums waiting for curing (drum no, line, unload time, item). The matching rule's suggestion is pre-selected.
  - Tank / chamber, compound, start time (defaults to now, can be edited).
  - The recipe is auto-looked up and the approved hours and expected end time are shown.
- **"End curing" action** on in-curing rows: end time and visual check. Actual hours and deviation are calculated, and an Under-cured warning shows before saving.
- List view with filters and status chips. Formulas (actual hrs, deviation, time check, test due) are computed by the system, so users never type them.

### 6.5 Hot Set Test
- A "Tests due" queue sorted by test due time, with overdue rows highlighted.
- Entry form: sample end, test type, readings, hot set %, permanent set %, **Result (Pass / Fail – required)**, remarks.
- Fail asks for confirmation ("This drum will be put on hold") and triggers the fail alert.

### 6.6 Ready to Send / Transfers
- Passed drums not yet sent, with ageing (0–24 h, 24–48 h, 48–72 h, > 72 h).
- Select drums → **Raise requisition** → requisition no → print / share.
- Mark the requisition **Dispatched** (fills sent_date for every drum on it).
- Failed drums are not selectable, with a tooltip explaining why.

### 6.7 Boiler Log
- A shift grid by date × Morning / Afternoon / Night. Filled cells are green, missing ones red after shift end.
- Quick entry form.

### 6.8 Alerts & Escalations
- **Alert Log:** every message sent, with filters by trigger, person, level and date, and the message text and delivery status.
- **Open escalations:** by person and level, showing the next level due time.
- A **Test mode** banner whenever live sending is off (Section 12).

### 6.9 Reports & Trends
- 30-day trend from Daily History: compliance %, missing count, pass rate, km per status.
- Ageing: passed but not sent, failed not re-cured.
- Line-wise and shift-wise compliance tables.
- All reports can be exported to Excel / PDF.

### 6.10 Masters & Settings (admin)
- Recipe, Product, Person, Responsibility: list, add, edit, deactivate (no delete). Recipe changes need approval.
- Settings: time limits, escalation timings, shift timings, sender route, test mode on/off, alerts_enabled_from.

### 6.11 How to Use
A short in-app help page for the plant team: what each status means, how to enter a curing row, a test and a boiler reading, and who gets which alert. It replaces the "How to Use" tab.

---

## 7. User experience standards (MUST)

The dashboard must feel **professional, calm and fast**. It's used on the shop floor (phones, gloves, poor light) and by the MD on the move.

**General**
- **Mobile-first.** Every screen works at 360 px wide. Tap targets are at least 44 × 44 px. The MD's Overview must be readable on a phone without zooming.
- **Speed:** pages load in under 2 s on 4G, and lists are paginated or virtualised. Show skeleton loaders, never a blank screen.
- **One action per screen.** Primary buttons are clear ("Start curing", "Save result"). Destructive or irreversible actions need confirmation.
- **Plain language.** Use the plant's words (drum, tank, hot set, Polypark), not technical terms. No raw error codes.
- **Every number is clickable** and opens the drums behind it.
- **Always show freshness:** "Last sync 10:58 IST" and "Latest drum 16-Nov 22:10" in the header.
- **Empty, loading and error states** are designed for every list, e.g. "No missing drums right now" for an empty list, or "Couldn't load. Retry" for an error.

**Forms**
- Defaults where safe (now for times, the logged-in user for "entered by").
- Inline validation with a clear message, for example "End time is before start time", or "Actual 7.5 h is less than approved 8 h – this will be marked Under-cured".
- Searchable dropdowns instead of free text for drums, tanks, compounds and products.
- Auto-save on inline edits with a visible "Saved" confirmation. Changes are never lost silently.

**Tables**
- Sticky header, sortable columns, filters that are remembered per user, column show/hide.
- Status as coloured **chips with text**, not colour alone.
- Times as `24-Nov 14:30` (IST), durations as `7 h 20 m`, lengths in m and totals in km (2 decimals).

**Accessibility**
- WCAG AA contrast, full keyboard use on desktop, and labels on every input.

---

## 8. Visual design

- **Style:** clean, white / light-grey background, cards with a soft border, no heavy shadows or gradients. Optional dark mode.
- **Typography:** one sans-serif family (e.g. Inter). Sizes 12 / 14 / 16 / 20 / 28. Numbers in tabular figures.
- **Spacing:** 8 px grid. Consistent 16–24 px card padding.
- **Status colours** (always with a text label):

| Status | Colour |
|---|---|
| Missing, Test overdue, Failed, Data error | Red |
| Late, Awaiting test, Under-cured | Amber |
| In curing, Requisition raised | Blue |
| Passed – ready to send, Cured on time | Green |
| Sent, Closed | Grey |

- **Charts:** simple bar / line charts, one colour per line (Sioplas 3, Sioplas 4), with axis labels and tooltips. No 3-D or pie charts for trends.
- **Branding:** company logo and name in the top bar. Keep it subtle.
- Build a small component library (button, chip, KPI tile, table, drawer, form field, toast) and use it everywhere for consistency.

---

## 9. Alerts and escalation

### 9.1 Escalation matrix (confirmed by MD on 23-Nov-26) **[CONFIG]**

| Trigger | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Drum not in curing | 6 h → Kuntal Khanra | 8 h → Mukesh | 12 h → Kamlesh + MD |
| Curing Log not updated | 4 h → Kuntal Khanra | 6 h → Mukesh | – |
| Under-cured drum | Immediately → Kuntal + Mukesh | Next day still open → MD | – |
| Test overdue | +2 h → Suvajit Kar | +6 h → Mukesh | +24 h → MD |
| Test failed | Immediately → Mukesh + Suvajit | Not re-cured in 24 h → MD | – |
| Passed, requisition not raised | Immediately → Prasenjit, Mukesh, Kamlesh, Kuntal | +24 h → Mukesh | +48 h → MD |
| Boiler reading missed | Shift end → Pravatranjan Pal | Next shift → Mukesh | – |

Times for "Drum not in curing" are counted from unload. "Test overdue" times are counted from test due.

### 9.2 Alert rules
- **One alert per drum per level only.** This is enforced by a unique key on `escalations (trigger, object, level)`.
- **Group** several drums into one message per person per run.
- An escalation stops as soon as the condition clears (for example, the drum gets a curing row).
- Every message is written to the **Alert Log**.
- If sending fails, retry 3 times, then show it as **Failed** on the Alerts page and in the MD summary.

### 9.3 Message templates (short, clear)

```
⚠️ Drums not in curing – Sioplas 4
3 drums unloaded more than 6 h ago have no curing entry:
• Drum 915 · 5,075 m · unloaded 16-Nov 08:10 (7 h 05 m)
• Drum 907 · 2,275 m · unloaded 16-Nov 09:40 (6 h 20 m)
• …
Please load and enter in the Curing Dashboard.
Level 1 · <link to Missing list>
```

```
✅ Hot set PASSED – send to Polypark
Lot L-123 · Drum 882 · 1,509 m
Lot L-124 · Drum 885 · 1,509 m
Total 3.02 km. Please raise the transfer requisition (Kharagpur → Polypark).
<link to Ready to Send>
```

Similar templates are needed for: Curing Log not updated, Under-cured, Test overdue, Test failed, Boiler reading missed, and the Daily MD summary.

### 9.4 Daily MD summary (08:15 IST)
One WhatsApp to the MD containing: yesterday's compliance % per line, missing now, in curing, awaiting test, test overdue, failed, passed not sent (with oldest age), sent yesterday (km), pass rate, open level-3 escalations, and failed messages. Include a link to the Overview.

---

## 10. Background jobs

| # | Job | Runs | Does |
|---|---|---|---|
| W1 | Drum sync | Every hour | Pull new Sioplas 3–4 entries from the SFG Dashboard, upsert by grid_entry_id, set data flags |
| W2 | Missing drum check | Every hour | Rules 1–3, update the tracker, escalations |
| W3 | Curing Log watch | Every hour | Rule 8 + under-cured check |
| W4 | Test watch | Every hour | Test overdue + failed alerts |
| W5 | Transfer requisition | Every hour | Passed-drums message (rule 7) + requisition escalations |
| W6 | Boiler log watch | End of each shift | Rule 9 |
| W7 | Daily MD summary | 08:15 IST | One WhatsApp to the MD |
| W0 | Curing Dashboard – Daily History (n8n ID `6tybtLKTiqwuEfEf`) | 08:00 IST | Existing – **keep**. After go-live, point it at the dashboard data (or let the dashboard write `daily_history` itself and retire W0 only with Asmita's approval). |

Job rules:
- **Idempotent:** running a job twice must not create duplicate rows or alerts.
- Each run is logged (start, end, rows read / changed, alerts, errors). A job that fails twice in a row alerts the admin.
- Rules W2–W5 also run **immediately** after a relevant form is saved, so the screen updates at once. The scheduled run is the safety net.

---

## 11. Users, roles and permissions

Sign-in with Google (company accounts only).

| Role | Who | Can |
|---|---|---|
| MD | Deepak Goel | See everything, write MD Remarks, approve go-live |
| Production head | Mukesh | See everything, edit masters, approve recipes, close Data errors |
| Curing team | Kuntal Khanra + team | Curing entries, link drums, Reason / Remarks on the tracker |
| Lab | Suvajit Kar | Hot Set Test entries |
| Boiler | Pravatranjan Pal | Boiler log |
| Planning | Kamlesh | Product Master, view all |
| Transfer | Prasenjit | Requisitions and dispatch |
| Admin | Asmita, developer | Settings, users, imports, job monitor |
| Viewer | Others | Read-only |

Rules:
- Auto columns are read-only for everyone in the UI.
- Editing a row after it's closed needs Production head or Admin, and the change is audited.

---

## 12. Development rules (from the handover doc, adapted)

1. Build and test on a **staging** copy. No test data in the live database.
2. The automation writes only its own fields. **Never** clear manual fields (Reason, Remarks, MD Remarks, ticks).
3. **Never delete rows.** Close them with a status.
4. Don't change the agreed data layout without telling Asmita.
5. Every alert is logged in the Alert Log.
6. **Test mode first:** in test mode, alerts go only to the test number(s) and are labelled `[TEST]`. Show the test results to the MD and get approval **before** live WhatsApp alerts are switched on.
7. Write the in-app **How to Use** page for the plant team.
8. Keep secrets (API keys, WhatsApp tokens) in environment variables, never in code or sheets.
9. Back up the database daily and test a restore before go-live.

---

## 13. Acceptance tests

Must pass on staging, with screenshots, before MD sign-off.

| # | Test | Expected |
|---|---|---|
| 1 | Drum on Sioplas 3, no curing row | Missing at 6 h, Kuntal gets **one** alert |
| 2 | Still missing at 8 h / 12 h | Mukesh at 8 h; Kamlesh + MD at 12 h |
| 3 | Curing row added late | Status Late with hours late; tracker row closes |
| 4 | Re-used drum number | Does **not** falsely match an old curing row |
| 5 | Same drum no twice on the same day | Data error; no auto-match |
| 6 | Short curing hours | Under-cured alert to Kuntal + Mukesh |
| 7 | Test due passed, no result | Overdue alert to Suvajit at +2 h |
| 8 | Failed sample | Hold alert; drum can't be put on a requisition |
| 9 | Passed drum | Message to Prasenjit, Mukesh, Kamlesh, Kuntal with lot, drum, length |
| 10 | Job run twice | No duplicate alerts for the same drum and level |
| 11 | Dashboard numbers | Match the Curing Sheet Summary at cut-over |
| 12 | Manual remarks | Survive every job run unchanged |
| 13 | Unknown unload time | Shown as "time unknown"; no 6-hour alert |
| 14 | Non-curing item (compact conductor) | Excluded from Missing |
| 15 | Mobile | Overview, Curing entry and Test entry usable on a 360 px phone |
| 16 | Feed stale > 2 h | Data health banner shows |

---

## 14. Rollout plan

| Step | What | Done when |
|---|---|---|
| 1 | Confirm decisions D1–D6 | Written down and agreed |
| 2 | Data model + import on staging | Reconciliation matches the Summary |
| 3 | Screens (Overview, Tracker, Curing, Tests, Transfers, Boiler) | Demo to Asmita |
| 4 | Rules + jobs in test mode | Acceptance tests 1–16 pass |
| 5 | Parallel run (1–2 weeks) | Sheet and dashboard numbers match daily |
| 6 | MD review and sign-off | MD approves |
| 7 | Go-live | Live alerts on, sheets read-only, How to Use shared |
| 8 | Polypark phase | Sioplas 1 & 2 added by configuration |

---

## 15. Open points

| # | Point | Owner | Status |
|---|---|---|---|
| 1 | Is the unload **time** available in the SFG Dashboard? | Puja | Pending |
| 2 | Source for drum-wise entries after 16-Nov-26 (Grid no longer used) | Puja / Samrat | Pending |
| 3 | WhatsApp route: Urgent WhatsApp sheet or direct API | Asmita + developer | Pending |
| 4 | Shift timings (Morning / Afternoon / Night) | Plant | Pending |
| 5 | MD and Prasenjit WhatsApp numbers | Asmita | Pending |
| 6 | Definition of "Sioplas running" for Rule 8 | Mukesh | Proposed in 5.8 |
| 7 | Developer access: SFG Dashboard login, n8n, sheets, server | Asmita | Pending |
| 8 | Where the dashboard lives (D1) | Asmita | Pending |
| – | Passed-drum recipients, escalation times, scope (Sioplas 3 & 4) | MD | **Done** |


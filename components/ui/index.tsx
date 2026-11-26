// Small shared component set (guide 8). Server-safe: no hooks here. Client pieces live in ./client.tsx.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// --- Status chips: colour always comes with a text label (guide 7, 8) -------------------------
export type Tone = "red" | "amber" | "blue" | "green" | "grey";
const TONE: Record<Tone, string> = {
  red: "bg-red-50 text-red-800 border-red-200",
  amber: "bg-amber-50 text-amber-900 border-amber-200",
  blue: "bg-blue-50 text-blue-800 border-blue-200",
  green: "bg-green-50 text-green-800 border-green-200",
  grey: "bg-slate-100 text-slate-700 border-slate-200",
};

/** Label and colour for every status value in the schema (DrumStatus, TrackerStatus, TimeCheck, …). */
export const STATUS: Record<string, { label: string; tone: Tone }> = {
  // DrumStatus (guide 5.9)
  MADE: { label: "Made", tone: "grey" },
  MISSING: { label: "Missing", tone: "red" },
  IN_CURING: { label: "In curing", tone: "blue" },
  AWAITING_TEST: { label: "Awaiting test", tone: "amber" },
  TEST_OVERDUE: { label: "Test overdue", tone: "red" },
  FAILED: { label: "Failed – hold / re-cure", tone: "red" },
  PASSED: { label: "Passed – ready to send", tone: "green" },
  REQUISITION_RAISED: { label: "Requisition raised", tone: "blue" },
  SENT: { label: "Sent", tone: "grey" },
  DATA_ERROR: { label: "Data error", tone: "red" },
  NOT_CURING_ITEM: { label: "Not a curing item", tone: "grey" },
  // TrackerStatus
  LATE: { label: "Late", tone: "amber" },
  CURED: { label: "Cured on time", tone: "green" },
  // TimeCheck / VisualCheck / TestResult
  OK: { label: "OK", tone: "green" },
  UNDER_CURED: { label: "Under-cured", tone: "amber" },
  NO_RECIPE: { label: "No recipe", tone: "red" },
  NOT_OK: { label: "Not OK", tone: "red" },
  PASS: { label: "Pass", tone: "green" },
  FAIL: { label: "Fail", tone: "red" },
  // RequisitionStatus / AlertStatus / RecipeStatus
  RAISED: { label: "Raised", tone: "blue" },
  DISPATCHED: { label: "Dispatched", tone: "grey" },
  RECEIVED: { label: "Received", tone: "grey" },
  CANCELLED: { label: "Cancelled", tone: "grey" },
  QUEUED: { label: "Queued", tone: "amber" },
  SKIPPED: { label: "Not sent – no number", tone: "amber" },
  DRAFT: { label: "Draft", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
  RETIRED: { label: "Retired", tone: "grey" },
  CLOSED: { label: "Closed", tone: "grey" },
};

export function Chip({ tone = "grey", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONE[tone])}>
      {children}
    </span>
  );
}

/** `<StatusChip status={drum.status} />` */
export function StatusChip({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400">–</span>;
  const s = STATUS[status] ?? { label: status, tone: "grey" as Tone };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

// --- Buttons: 44 px tap targets (guide 7) -----------------------------------------------------
const BTN = {
  primary: "bg-blue-700 text-white hover:bg-blue-800",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
};
export const btnClass = (variant: keyof typeof BTN = "primary") =>
  cx(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50",
    BTN[variant],
  );

export function Button({ variant, className, ...p }: ComponentProps<"button"> & { variant?: keyof typeof BTN }) {
  return <button {...p} className={cx(btnClass(variant), className)} />;
}
export function LinkButton({ variant, className, ...p }: ComponentProps<typeof Link> & { variant?: keyof typeof BTN }) {
  return <Link {...p} className={cx(btnClass(variant), className)} />;
}

// --- Layout pieces ----------------------------------------------------------------------------
export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-600">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white p-4", className)}>
      {title && <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>}
      {children}
    </section>
  );
}

/** KPI tile. Every number is clickable (guide 7): `href` opens the drums behind it. */
export function KpiTile({ label, value, sub, tone = "grey", href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; href: string }) {
  const bar = { red: "bg-red-600", amber: "bg-amber-500", blue: "bg-blue-600", green: "bg-green-600", grey: "bg-slate-400" }[tone];
  return (
    <Link href={href} className="relative block min-h-11 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 pl-5 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-blue-700">
      <span className={cx("absolute inset-y-0 left-0 w-1", bar)} aria-hidden />
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="mt-1 text-[28px] leading-8 font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-600">{sub}</div>}
    </Link>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">{children}</div>;
}

export function Banner({ tone = "amber", children }: { tone?: Tone; children: ReactNode }) {
  return <div role="status" className={cx("mb-4 rounded-md border px-3 py-2 text-sm", TONE[tone])}>{children}</div>;
}

// --- Table: own scroll area, fixed header, search and a filter on every column (see ./table.tsx) ---
// Use plain <thead>/<tbody>/<tr>/<th>/<td> inside.
export { Table } from "./table";

// --- Form fields: every input has a label (guide 7) ---------------------------------------------
export const inputClass =
  "block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-700 disabled:bg-slate-100";

/** Label + control + hint / error. Put the <input>/<select>/<textarea> as children with id={id}. */
export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input {...p} className={cx(inputClass, className)} />;
}
export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select {...p} className={cx(inputClass, className)} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea rows={2} {...p} className={cx(inputClass, "py-2", className)} />;
}

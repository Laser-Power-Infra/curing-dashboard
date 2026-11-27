// Shared shell: top bar (name, search, freshness, user) + left nav that becomes a bottom tab bar on a phone (guide 6).
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { viewer, signOut } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fmtDateOnly, fmtDateTime } from "@/lib/format";
import { NavLinks, ThemeToggle } from "@/components/ui/client";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/office", label: "Office" },
  { href: "/tracker", label: "Missing drums" },
  { href: "/curing", label: "Curing log" },
  { href: "/tests", label: "Hot set test" },
  { href: "/transfers", label: "Ready to send" },
  { href: "/boiler", label: "Boiler log" },
  { href: "/unload", label: "Unload entry" },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings", label: "Settings" },
  { href: "/help", label: "How to use" },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await viewer();
  const [settings, lastSync, latestDrum] = await Promise.all([
    getSettings(),
    prisma.jobRun.findFirst({ where: { job: { in: ["SHEET_SYNC", "W1_DRUM_SYNC"] }, status: "SUCCESS" }, orderBy: { startedAt: "desc" } }),
    prisma.drum.findFirst({ orderBy: [{ unloadDate: "desc" }, { unloadedAt: "desc" }] }),
  ]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900 print:h-auto print:overflow-visible">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2">Skip to content</a>
      <header className="z-30 shrink-0 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link href="/" className="text-sm font-semibold text-slate-900">
            Laser Power &amp; Infra <span className="font-normal text-slate-600">· Curing</span>
          </Link>
          <form action="/drums" className="order-last w-full sm:order-none sm:w-64">
            <label htmlFor="q" className="sr-only">Search by drum no, lot no or Grid ID</label>
            <input id="q" name="q" type="search" placeholder="Search drum no, lot no, Grid ID" className="min-h-11 w-full rounded-md border border-slate-300 px-3 text-base sm:text-sm" />
          </form>
          <div className="ml-auto text-right text-xs leading-4 text-slate-600">
            <div>Last sync {lastSync ? `${fmtDateTime(lastSync.startedAt)} IST` : "never"}</div>
            <div>Latest drum {latestDrum ? (latestDrum.unloadedAt ? fmtDateTime(latestDrum.unloadedAt) : fmtDateOnly(latestDrum.unloadDate)) : "none"}</div>
          </div>
          <ThemeToggle />
          {user.email ? (
            <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
              <button className="min-h-11 rounded-md px-2 text-xs text-slate-700 hover:bg-slate-100" title={user.email}>
                {user.name} · Sign out
              </button>
            </form>
          ) : (
            <Link href="/login" className="flex min-h-11 items-center rounded-md px-2 text-xs font-medium text-blue-700 hover:bg-slate-100">Sign in</Link>
          )}
        </div>
        {settings.testMode && (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-1 text-xs font-medium text-amber-900">
            Test mode: WhatsApp alerts go only to the test numbers and are labelled [TEST].
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Main" className="hidden w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-white p-2 md:flex">
          <NavLinks items={NAV} />
        </nav>
        <main id="main" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 pb-20 md:p-6 print:overflow-visible">{children}</main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto border-t border-slate-200 bg-white p-1 md:hidden">
        <NavLinks items={NAV} />
      </nav>
    </div>
  );
}

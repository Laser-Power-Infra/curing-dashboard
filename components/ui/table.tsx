"use client";
// The one table used on every screen. Pages keep writing plain <thead>/<tbody>/<tr>/<th>/<td>.
// It has its own scroll area with a fixed header, a search box, and a filter on the column headers
// (tick the values to show, like a spreadsheet filter).
//
// Two ways of working:
//   <Table server={…}>  the long lists. Search, filters and the 25-row pages go into the URL as you type
//                       or tick, and the page queries the database (lib/table.ts). The filters are
//                       facets: each list shows the values and counts left by the other filters.
//   <Table>             short tables whose rows are all on the page: filtered and paged here, in the browser.
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { PAGE_SIZE, type ServerTable } from "@/lib/table";

type Col = { th: HTMLTableCellElement; host: HTMLElement; index: number; label: string; hasText: boolean };
type Option = { value: string; label: string; count: number };
type Open = { col: Col; left: number; top: number; listMax: number; options: Option[] };

const BLANK = "(blank)";
const SEARCH_FROM = 8; // browser-filtered tables with fewer rows need no search box
// A cell holding a form control has no fixed text to filter on.
const cellText = (td?: Element | null) => (!td || td.querySelector("input,select,textarea") ? "" : (td.textContent ?? "").replace(/\s+/g, " ").trim());

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const FUNNEL = "M2 3h12l-4.5 5.5V13l-3-1.5V8.5L2 3Z";
const SEARCH = "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Zm3.5-1.5L14 14";

const field = "min-h-10 w-full rounded-md border border-slate-300 bg-white pr-3 pl-9 text-base text-slate-900 placeholder:text-slate-500 focus:border-blue-700 focus:ring-1 focus:ring-blue-700 focus:outline-none sm:text-sm";
const link = "rounded px-1 font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-blue-700";
const pageBtn = "inline-flex min-h-10 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40";
const thin = "[scrollbar-color:var(--color-slate-300)_transparent] [scrollbar-width:thin]";

export function Table({ children, server }: { children: ReactNode; server?: ServerTable }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const table = useRef<HTMLTableElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const countEl = useRef<HTMLSpanElement>(null);
  const empty = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pager = useRef<HTMLElement>(null);
  const lastPage = useRef(1);
  const [cpage, setCpage] = useState(1); // browser mode: page of the rows that pass the filters
  const [cols, setCols] = useState<Col[]>([]);
  const [version, setVersion] = useState(0); // bumped when the rows change under us (new server data)
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string[]>>({}); // browser mode: ticked values per column
  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState<string[]>([]); // server mode: the ticks as clicked, ahead of the answer from the server
  const searchEl = useRef<HTMLInputElement>(null);
  const waiting = useRef<{ timer?: ReturnType<typeof setTimeout>; changes: Record<string, string | string[] | null> }>({ changes: {} });
  const [optQuery, setOptQuery] = useState("");

  const bodyRows = () => Array.from(table.current?.tBodies ?? []).flatMap((b) => Array.from(b.rows));
  const pickedOf = (c: Col) => (server ? (server.filters[c.label]?.picked ?? []) : (filters[c.index] ?? []));
  const filtering = server ? !!server.q || Object.values(server.filters).some((f) => f.picked.length) : !!query || Object.values(filters).some((v) => v.length);

  /** Server mode: change URL parameters and let the page query again. Any change goes back to page 1. */
  function go(changes: Record<string, string | string[] | null>, typing = false) {
    const u = new URLSearchParams(window.location.search);
    if (!("page" in changes)) u.delete("page");
    for (const [k, v] of Object.entries(changes)) {
      u.delete(k);
      for (const one of Array.isArray(v) ? v : v ? [v] : []) u.append(k, one);
    }
    // Typing and ticking replace the address instead of adding a Back step for every letter.
    startTransition(() => router[typing ? "replace" : "push"](`${window.location.pathname}?${u}`, { scroll: false }));
  }
  /** The same, a moment after the last keystroke or tick, so a burst of them is one query. */
  function soon(changes: Record<string, string | string[] | null>) {
    const w = waiting.current;
    clearTimeout(w.timer);
    w.changes = { ...w.changes, ...changes };
    w.timer = setTimeout(() => { go(w.changes, true); w.changes = {}; }, 300);
  }
  const clear = () => {
    if (!server) return void (setQuery(""), setFilters({}), setCpage(1));
    clearTimeout(waiting.current.timer);
    waiting.current.changes = {};
    if (searchEl.current) searchEl.current.value = "";
    setDraft([]);
    go({ q: null, ...Object.fromEntries(Object.values(server.filters).map((f) => [f.param, null])) });
  };

  // Find the column headers and give each a place for its filter button.
  useEffect(() => {
    const t = table.current!;
    const sync = () => {
      const rows = bodyRows();
      const heads = Array.from(t.tHead?.rows[0]?.cells ?? []);
      const next = heads.some((th) => th.colSpan > 1)
        ? []
        : heads
            .map((th, index) => ({ th, index, label: (th.textContent ?? "").trim() }))
            .filter((c) => c.label)
            .map((c) => {
              // React will not render into the <th> itself (it owns its text), so the filter button gets its own element inside it.
              let host = c.th.querySelector<HTMLElement>(":scope > [data-filter-host]");
              if (!host) {
                host = document.createElement("span");
                host.dataset.filterHost = "";
                c.th.append(host);
              }
              return { ...c, host, hasText: rows.some((r) => cellText(r.cells[c.index])) };
            });
      setCols((old) => (old.length === next.length && old.every((c, i) => c.host === next[i].host && c.label === next[i].label && c.hasText === next[i].hasText) ? old : next));
      setVersion((v) => v + 1);
    };
    const first = requestAnimationFrame(sync);
    const seen = new MutationObserver(sync);
    for (const b of [t.tHead, ...Array.from(t.tBodies)]) if (b) seen.observe(b, { childList: true, subtree: true, characterData: true });
    return () => { cancelAnimationFrame(first); seen.disconnect(); };
  }, []);

  // Browser mode: show or hide each row. Written straight to the rows: the page renders them, not this component.
  const isServer = !!server;
  useEffect(() => {
    if (isServer) return;
    const rows = bodyRows();
    const q = query.trim().toLowerCase();
    const on = Object.entries(filters).filter(([, v]) => v.length);
    const pass = rows.map(
      (r) =>
        (!q || Array.from(r.cells).some((c) => cellText(c).toLowerCase().includes(q))) &&
        on.every(([i, v]) => v.includes(cellText(r.cells[Number(i)]) || BLANK)),
    );
    const shown = pass.filter(Boolean).length;
    const last = Math.max(1, Math.ceil(shown / PAGE_SIZE));
    const page = Math.min(cpage, last);
    lastPage.current = last;
    let n = 0;
    rows.forEach((r, i) => {
      r.hidden = !pass[i];
      if (pass[i]) n++;
      // Rows of other pages are hidden on screen only (globals.css), so a print still has every row.
      r.toggleAttribute("data-off", pass[i] && (n <= (page - 1) * PAGE_SIZE || n > page * PAGE_SIZE));
    });
    const active = !!q || on.length > 0;
    if (bar.current) bar.current.hidden = rows.length < SEARCH_FROM && !active;
    if (countEl.current)
      countEl.current.textContent = shown === 0 ? "0 rows" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, shown)} of ${shown}${active ? ` (filtered from ${rows.length})` : ""}`;
    if (empty.current) empty.current.hidden = shown > 0 || !active;
    if (pager.current) {
      pager.current.hidden = last <= 1;
      const [prev, text, next] = Array.from(pager.current.children) as [HTMLButtonElement, HTMLElement, HTMLButtonElement];
      prev.disabled = page <= 1;
      next.disabled = page >= last;
      text.textContent = `Page ${page} of ${last}`;
    }
  }, [isServer, query, filters, version, cpage]);
  const turn = (by: number) => {
    setCpage((p) => Math.max(1, Math.min(lastPage.current, Math.min(p, lastPage.current) + by)));
    if (scroller.current) scroller.current.scrollTop = 0;
  };

  // The filter list opens in the top layer so the scroll area cannot clip it; it closes when anything scrolls.
  useEffect(() => {
    const p = pop.current;
    if (!open || !p) return;
    if (!p.matches(":popover-open")) p.showPopover();
    p.querySelector("input")?.focus();
    const close = (e: Event) => { if (!(e.target instanceof Node && p.contains(e.target))) p.hidePopover(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);

  function openFor(col: Col, button: HTMLElement) {
    let options = server?.filters[col.label]?.options;
    if (!options) {
      const counts = new Map<string, number>();
      for (const r of bodyRows()) {
        const v = cellText(r.cells[col.index]) || BLANK;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      options = [...counts].map(([value, count]) => ({ value, label: value, count })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    }
    const rect = col.th.getBoundingClientRect();
    opener.current = button;
    setOptQuery("");
    setDraft(pickedOf(col));
    setOpen({ col, options, left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), top: rect.bottom + 4, listMax: Math.max(120, Math.min(256, window.innerHeight - rect.bottom - 120)) }); // the list shrinks rather than cover the header
  }

  const picked = !open ? [] : server ? draft : (filters[open.col.index] ?? []);
  const setPicked = (next: string[]) => {
    if (!open) return;
    if (server) { setDraft(next); soon({ [server.filters[open.col.label].param]: next }); }
    else { setFilters((f) => ({ ...f, [open.col.index]: next })); setCpage(1); }
  };
  const needle = optQuery.trim().toLowerCase();
  // Server mode: the list follows the server, so its counts change as other filters and the search change.
  const options = open ? ((server && server.filters[open.col.label]?.options) || open.options).filter((o) => o.label.toLowerCase().includes(needle)) : [];
  const pages = server ? Math.max(1, Math.ceil(server.total / server.pageSize)) : 1;

  return (
    <div data-fit={server ? "" : undefined} className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div ref={bar} hidden={!server} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 p-2 print:hidden">
        {server ? (
          server.q !== null && (
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Search all rows</span>
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500"><Icon d={SEARCH} /></span>
              <input ref={searchEl} type="search" defaultValue={server.q} onChange={(e) => soon({ q: e.target.value.trim() || null })} placeholder="Search all rows" className={field} />
            </label>
          )
        ) : (
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search this table</span>
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500"><Icon d={SEARCH} /></span>
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setCpage(1); }} placeholder="Search this table" className={field} />
          </label>
        )}
        {server ? (
          <span role="status" className="text-sm text-slate-600">
            {busy ? "Loading…" : server.total === 0 ? "0 rows" : `${(server.page - 1) * server.pageSize + 1}–${Math.min(server.page * server.pageSize, server.total)} of ${server.total}`}
          </span>
        ) : (
          <span ref={countEl} role="status" className="text-sm text-slate-600" />
        )}
        {filtering && <button type="button" onClick={clear} className={`${link} min-h-10 text-sm`}>Clear filters</button>}
        {server && pages > 1 && (
          <nav aria-label="Pages" className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            <button type="button" disabled={server.page <= 1 || busy} onClick={() => go({ page: String(server.page - 1) })} className={pageBtn}>Previous</button>
            <span className="whitespace-nowrap">Page {server.page} of {pages}</span>
            <button type="button" disabled={server.page >= pages || busy} onClick={() => go({ page: String(server.page + 1) })} className={pageBtn}>Next</button>
          </nav>
        )}
        {!server && (
          <nav ref={pager} hidden aria-label="Pages" className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            <button type="button" onClick={() => turn(-1)} className={pageBtn}>Previous</button>
            <span className="whitespace-nowrap" />
            <button type="button" onClick={() => turn(1)} className={pageBtn}>Next</button>
          </nav>
        )}
      </div>

      <div ref={scroller} data-scroll aria-busy={busy} className={`max-h-[70vh] overflow-auto transition-opacity print:max-h-none print:overflow-visible ${thin} ${busy ? "opacity-60" : ""}`}>
        <table
          ref={table}
          className="w-full border-collapse text-sm [&_td]:border-t [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-middle [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:h-10 [&_th]:bg-slate-50 [&_th]:py-2 [&_th]:pr-9 [&_th]:pl-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:whitespace-nowrap [&_th]:text-slate-700 [&_th]:shadow-[inset_0_-1px_0_var(--color-slate-200)] [&_tbody_tr:hover]:bg-slate-50"
        >
          {children}
        </table>
        <div ref={empty} hidden={server ? server.total > 0 : true} className="px-4 py-10 text-center text-sm text-slate-600">
          {filtering ? <>No rows match. <button type="button" onClick={clear} className={link}>Clear filters</button></> : "Nothing here yet."}
        </div>
      </div>

      {cols
        .filter((c) => (server ? !!server.filters[c.label] : c.hasText))
        .map((c) => {
          const on = pickedOf(c).length > 0;
          return createPortal(
            <button
              type="button"
              aria-label={`Filter by ${c.label}${on ? " (filter on)" : ""}`}
              aria-haspopup="dialog"
              onClick={(e) => openFor(c, e.currentTarget)}
              className={`absolute inset-0 flex cursor-pointer items-center justify-end pr-2.5 hover:bg-slate-900/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700 print:hidden ${
                on ? "text-blue-700 shadow-[inset_0_-2px_0_var(--color-blue-700)]" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon d={FUNNEL} />
            </button>,
            c.host,
            c.index,
          );
        })}

      <div
        ref={pop}
        popover="auto"
        role="dialog"
        aria-label={open ? `Filter by ${open.col.label}` : undefined}
        onToggle={(e) => {
          if (e.newState !== "closed" || e.currentTarget.matches(":popover-open")) return;
          setOpen(null);
          // Give focus back to the header only when closing left it nowhere (Escape); a click elsewhere keeps its own focus.
          const at = document.activeElement;
          if (!at || at === document.body || e.currentTarget.contains(at)) opener.current?.focus();
        }}
        style={{ inset: "auto", left: open?.left, top: open?.top, margin: 0 }}
        className="w-72 rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-lg shadow-slate-900/10"
      >
        {open && (
          <>
            <label className="relative block">
              <span className="sr-only">Search {open.col.label} values</span>
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500"><Icon d={SEARCH} /></span>
              <input type="search" value={optQuery} onChange={(e) => setOptQuery(e.target.value)} placeholder={`Search ${open.col.label.toLowerCase()}`} className={field} />
            </label>
            <div className="flex items-center justify-between px-1 py-2 text-xs text-slate-600">
              <span>{picked.length ? `${picked.length} ticked` : "Tick values to show only those rows"}</span>
              <span className="flex gap-2">
                {needle && options.length > 0 && (
                  <button type="button" onClick={() => setPicked([...new Set([...picked, ...options.map((o) => o.value)])])} className={link}>Tick all {options.length}</button>
                )}
                {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className={link}>Clear</button>}
              </span>
            </div>
            <ul style={{ maxHeight: open.listMax }} className={`overflow-y-auto ${thin}`}>
              {options.slice(0, 300).map((o) => (
                <li key={o.value}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1 hover:bg-slate-100">
                    <input
                      type="checkbox"
                      checked={picked.includes(o.value)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, o.value] : picked.filter((p) => p !== o.value))}
                      className="size-4 accent-blue-700"
                    />
                    <span className={`min-w-0 flex-1 truncate ${o.value === BLANK ? "text-slate-500" : ""}`} title={o.label}>{o.label}</span>
                    <span className="text-xs text-slate-500">{o.count}</span>
                  </label>
                </li>
              ))}
              {!options.length && <li className="px-1 py-3 text-slate-600">No value matches.</li>}
              {options.length > 300 && <li className="px-1 py-2 text-xs text-slate-600">Showing the first 300. Search to narrow the list.</li>}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

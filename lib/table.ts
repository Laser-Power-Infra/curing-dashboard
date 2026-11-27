// Server side of the list tables: 25 rows a page, search, and the column-header filters.
// The page reads the URL with these helpers, queries the database, and hands <Table server={…}> the result.
export type SP = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 25;
export const BLANK = "(blank)";

/** Every value of a URL parameter (?status=A&status=B). */
export const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);
export const pageOf = (sp: SP) => Math.max(1, Math.floor(Number(many(sp.page)[0])) || 1);
export const searchOf = (sp: SP) => many(sp.q)[0] ?? "";

export type Facet = { param: string; picked: string[]; options: { value: string; label: string; count: number }[] };
/** What the Table needs to draw the search box, the header filters and the pager. `q: null` = no search box. */
export type ServerTable = { total: number; page: number; pageSize: number; q: string | null; filters: Record<string, Facet> };

type Column = {
  header: string;
  param?: string;
  int?: boolean;
  label?: (value: string) => string;
  /** enum columns: the values the database accepts */ values?: readonly string[];
  /** the field is on this relation of the listed table (e.g. "drum" for a drum's party on a curing row) */ on?: string;
};

/**
 * Column-header filters for one list, as facets. `columns` maps a database field to its column header.
 * `group` counts the rows per value of a field, under the conditions it is given (a Prisma groupBy).
 * Each column is counted with the other columns' ticks applied but not its own, so its list shows
 * what ticking a value would give. Returns the Prisma conditions (put them under AND) and the lists.
 */
export async function facets<F extends string>(sp: SP, columns: Record<F, Column>, group: (field: F, others: object[]) => Promise<{ value: unknown; count: number }[]>) {
  const fields = Object.keys(columns) as F[];
  const picked = fields.map((field) => {
    const c = columns[field];
    // Only values the column can hold are accepted, so a hand-typed URL cannot break the query.
    return many(sp[c.param ?? field]).filter((v) => v === BLANK || (c.int ? /^\d+$/.test(v) : !c.values || c.values.includes(v)));
  });
  const conditions = fields.map((field, i) => {
    const values = picked[i].filter((v) => v !== BLANK).map((v) => (columns[field].int ? Number(v) : v));
    const parts = [...(values.length ? [{ [field]: { in: values } }] : []), ...(picked[i].includes(BLANK) ? [{ [field]: null }] : [])];
    const cond = parts.length > 1 ? { OR: parts } : parts[0];
    const on = columns[field].on;
    return cond && on ? { [on]: cond } : cond;
  });
  const groups = await Promise.all(fields.map((field, i) => group(field, conditions.filter((c, j) => c && j !== i) as object[])));
  const filters: Record<string, Facet> = {};
  fields.forEach((field, i) => {
    const c = columns[field];
    const options = groups[i].map((g) => ({ value: g.value == null || g.value === "" ? BLANK : String(g.value), count: g.count }));
    // A ticked value the other filters have emptied stays in the list (count 0) so it can be unticked.
    for (const v of picked[i]) if (!options.some((o) => o.value === v)) options.push({ value: v, count: 0 });
    filters[c.header] = {
      param: c.param ?? field,
      picked: picked[i],
      options: options
        .map((o) => ({ ...o, label: o.value === BLANK ? BLANK : (c.label?.(o.value) ?? o.value) }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    };
  });
  return { where: conditions.filter(Boolean) as object[], filters };
}

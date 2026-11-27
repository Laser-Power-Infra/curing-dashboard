// The drums this dashboard is about: curing items made on the in-scope lines (Sioplas 3 and 4).
// Every list and count uses this one filter, so the pages agree with each other.
export const drumScope = (lineCode?: string) => ({ isCuringItem: true, line: { inScope: true, ...(lineCode && { code: lineCode }) } });

/** The same filter for curing-log queries. A curing row not linked to a drum is left out. */
export const logScope = (lineCode?: string) => ({ drum: drumScope(lineCode) });

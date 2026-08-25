// Keyset (cursor) pagination over a (created_at, id) sort key, DESC. Every list query returns the
// uniform cursor-paginated envelope (cursor-based, never offset): a cursor is stable under concurrent
// inserts, where offset would double-show or skip rows. The cursor is an OPAQUE wire contract — its
// btoa(JSON) encoding must stay byte-identical so a cursor minted by one deploy still decodes on the
// next; treat it as a string, never parse its shape elsewhere.

export const DEFAULT_PAGE_SIZE = 50;

export interface Page<Row> {
  readonly data: readonly Row[];
  readonly nextCursor: string | null;
}

export interface SortCursor {
  readonly createdAt: string;
  readonly id: string;
}

// The opaque continuation token over the (created_at, id) sort key.
export function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify({ c: createdAt, i: id }));
}

export function decodeCursor(cursor: string | undefined): SortCursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(atob(cursor)) as { c?: unknown; i?: unknown };
    if (typeof parsed.c === "string" && typeof parsed.i === "string") {
      return { createdAt: parsed.c, id: parsed.i };
    }
  } catch {
    // A malformed/tampered cursor reveals nothing and is treated as the first page.
  }
  return undefined;
}

// The (created_at, id) keyset predicate: rows strictly "after" the cursor in DESC order. Pushes the
// condition and its three bindings onto the caller's WHERE-clause accumulators (no-op without a
// cursor), so a list statement reads the same regardless of which page it serves.
export function appendCursorPredicate(
  conditions: string[],
  bindings: unknown[],
  cursor: SortCursor | undefined,
): void {
  if (cursor === undefined) return;
  conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
  bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
}

// The ascending counterpart, for the reads whose natural order is soonest-first rather than
// newest-first — an upcoming-deadline list is the case that forced it, because a page of the FIRST
// fifty deadlines is the answer and the last fifty is not. It shares the cursor encoding above
// deliberately: the wire contract must not fork, so a cursor is the same opaque (sort key, id) pair
// whichever direction minted it, and only the comparison flips.
export function appendAscendingCursorPredicate(
  conditions: string[],
  bindings: unknown[],
  cursor: SortCursor | undefined,
): void {
  if (cursor === undefined) return;
  conditions.push("(created_at > ? OR (created_at = ? AND id > ?))");
  bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
}

// The same predicate over a caller-named sort column, for a table whose order key is not created_at
// (a deadline sorts by due_on, an event by starts_on). The column name is a CODE-supplied literal —
// never request input — because it is interpolated into the SQL text; callers pass a constant.
export function appendCursorPredicateOnColumn(
  conditions: string[],
  bindings: unknown[],
  cursor: SortCursor | undefined,
  options: { readonly sortColumn: string; readonly idColumn: string; readonly ascending: boolean },
): void {
  if (cursor === undefined) return;
  const comparison = options.ascending ? ">" : "<";
  conditions.push(
    `(${options.sortColumn} ${comparison} ? OR (${options.sortColumn} = ? AND ${options.idColumn} ${comparison} ?))`,
  );
  bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
}

// The same keyset predicate as a CLAUSE rather than an entry in a conditions array, for a statement
// assembled by string concatenation instead of by joining conditions with AND. Discovery's reads are
// the case that forced it: each composes an access predicate into a hand-written WHERE, and the
// keyset has to land between that predicate and the ORDER BY so the visibility fitness pass still
// sees the predicate ahead of the LIMIT. Returns "" with no cursor, and pushes its three bindings in
// the order the clause reads them.
//
// Both column names are CODE-supplied literals — never request input — because they are interpolated
// into the SQL text.
export function keysetClause(
  bindings: unknown[],
  cursor: SortCursor | undefined,
  sortColumn: string,
  idColumn: string,
  ascending: boolean,
): string {
  if (cursor === undefined) return "";
  const comparison = ascending ? ">" : "<";
  bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  return (
    `AND (${sortColumn} ${comparison} ? ` +
    `OR (${sortColumn} = ? AND ${idColumn} ${comparison} ?)) `
  );
}

// A row carrying the raw sort-key columns a query selects, so the assembly can mint the next cursor.
interface SortKeyRow {
  readonly created_at: string;
  readonly id: string;
}

// Assembles the page envelope from a statement run with LIMIT pageSize + 1: the extra row is the
// has-more probe (trimmed off the returned data), and the last kept row's (created_at, id) becomes
// the next cursor. `map` projects each raw row to its public list item.
export function assemblePage<Row extends SortKeyRow, Item>(
  results: readonly Row[],
  pageSize: number,
  map: (row: Row) => Item,
): Page<Item> {
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows.map(map),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Three-part keyset, for a read whose order needs a column BETWEEN the sort key and the identifier.
//
// The two-part (sort key, id) cursor above covers every list whose display order is one column plus
// a tiebreak. It does not cover a read whose middle column carries meaning: an asset's valuations
// sort by as_of_date and then by recorded_at, because two assertions about the same date are ordered
// by which one was made later, and re-ordering those by identifier would put the superseded figure
// first at random. A matter's staffing groups by role before it runs in time. In both, dropping the
// middle column to fit the two-part cursor changes what the answer MEANS, so the cursor grows
// instead.
//
// The wire encoding extends the same opaque object with one more key rather than forking the format:
// `{ c, s, i }`. A two-part cursor still decodes here (`s` absent), and a three-part cursor still
// decodes in `decodeCursor` as its (c, i) prefix — which is a coarser page boundary, never a wrong
// one, so a token minted by one deploy is safe to hand to the other.

export interface CompositeSortCursor {
  readonly primary: string;
  readonly secondary: string;
  readonly id: string;
}

export function encodeCompositeCursor(primary: string, secondary: string, id: string): string {
  return btoa(JSON.stringify({ c: primary, s: secondary, i: id }));
}

export function decodeCompositeCursor(cursor: string | undefined): CompositeSortCursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(atob(cursor)) as { c?: unknown; s?: unknown; i?: unknown };
    if (
      typeof parsed.c === "string" &&
      typeof parsed.s === "string" &&
      typeof parsed.i === "string"
    ) {
      return { primary: parsed.c, secondary: parsed.s, id: parsed.i };
    }
  } catch {
    // A malformed/tampered cursor reveals nothing and is treated as the first page.
  }
  return undefined;
}

// The three-part predicate, written as the lexicographic comparison spelled out rather than as a
// row-value comparison: SQLite supports `(a, b, c) < (?, ?, ?)`, but the spelled-out form is what
// the (primary, secondary) index can actually seek on, and this read exists to be indexed.
//
// All three column names are CODE-supplied literals — never request input — because they are
// interpolated into the SQL text. Returns "" with no cursor, and pushes its six bindings in the
// order the clause reads them.
export function compositeKeysetClause(
  bindings: unknown[],
  cursor: CompositeSortCursor | undefined,
  columns: { readonly primary: string; readonly secondary: string; readonly id: string },
  ascending: boolean,
): string {
  if (cursor === undefined) return "";
  const comparison = ascending ? ">" : "<";
  bindings.push(
    cursor.primary,
    cursor.primary,
    cursor.secondary,
    cursor.primary,
    cursor.secondary,
    cursor.id,
  );
  return (
    `AND (${columns.primary} ${comparison} ? ` +
    `OR (${columns.primary} = ? AND ${columns.secondary} ${comparison} ?) ` +
    `OR (${columns.primary} = ? AND ${columns.secondary} = ? AND ${columns.id} ${comparison} ?)) `
  );
}

// The page envelope for a three-part keyset. `key` reads the cursor columns off a row rather than
// fixing their names, because the two consumers sort by different columns and neither is created_at.
export function assembleCompositePage<Row, Item>(
  results: readonly Row[],
  pageSize: number,
  key: (row: Row) => CompositeSortCursor,
  map: (row: Row) => Item,
): Page<Item> {
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  if (!hasMore || last === undefined) return { data: rows.map(map), nextCursor: null };
  const { primary, secondary, id } = key(last);
  return { data: rows.map(map), nextCursor: encodeCompositeCursor(primary, secondary, id) };
}

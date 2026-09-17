import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { DescribeRequest, SourceReadRequest, TimelineRawRow } from "./registry.ts";

// The one place a source's SELECT is assembled, so the three properties every source has to have are
// structural rather than remembered:
//
//   1. The visible-matter predicate is composed into the WHERE clause, and it is composed BEFORE the
//      LIMIT — a source hands in the expression naming its matter and cannot decline to.
//   2. Every statement carries a LIMIT. An unbounded source is an unbounded page.
//   3. Every statement carries the keyset predicate over the same (sort key, id) pair the merge
//      compares, so one cursor serves every source from one global position.
//
// The parameters are code-supplied literals throughout — column names and table names are constants
// in the source modules, never request input. Everything a caller supplies arrives as a binding.

export interface BoundedSelectSpec {
  readonly request: SourceReadRequest;
  // The table (or join) the read walks, e.g. "matter_event" or
  // "custody_movement JOIN custody_packet ON custody_packet.id = custody_movement.packet_id".
  readonly from: string;
  // The column the timeline sorts on, qualified where the FROM clause joins.
  readonly sortColumn: string;
  // The row's own identifier column, the tiebreak that makes the order total.
  readonly idColumn: string;
  // What a reader opens, where that differs from the row itself (see TimelineRawRow.link_id).
  // Defaults to the row.
  readonly linkIdExpression?: string;
  // The expression naming this row's matter — handed to the visibility predicate, and projected so
  // a merged page can say which case an entry belongs to.
  readonly matterExpression: string;
  // A SQL expression producing the entry's kind: a literal for a single-kind source, a column for
  // one that emits several.
  readonly kindExpression: string;
  // The acting member, or the literal NULL where the source records none.
  readonly actorExpression: string;
  // The DECLARED non-privileged label, or the literal NULL where the source declares it has none.
  readonly labelExpression: string;
  // The wall-clock time of day this row falls at and the zone it is read in, as SQL expressions —
  // absent on a source whose rows have no hour, which projects NULL for both. It is the same class
  // of fact the sort key already is (when a thing happens, in the record's own terms) and carries
  // nothing about a case, which is why it rides a projection a title may not.
  readonly timeOfDayExpression?: string;
  readonly timeZoneExpression?: string;
  // Source-specific narrowing (a matter filter, a state filter, a date window), already expressed
  // with `?` placeholders in binding order.
  readonly conditions: readonly string[];
  readonly bindings: readonly unknown[];
}

// Builds one bounded, predicate-composed, keyset-paginated statement.
export function boundedSelect(database: SqlDatabase, spec: BoundedSelectSpec): SqlStatement {
  const { request } = spec;
  const conditions: string[] = [...spec.conditions];
  const bindings: unknown[] = [...spec.bindings];

  // The keyset predicate, in the same direction the merge sorts. It is applied here rather than by
  // the caller so no source can page without it.
  if (request.cursor !== undefined) {
    const comparison = request.ascending ? ">" : "<";
    conditions.push(
      `(${spec.sortColumn} ${comparison} ? OR (${spec.sortColumn} = ? AND ${spec.idColumn} ${comparison} ?))`,
    );
    bindings.push(request.cursor.sortKey, request.cursor.sortKey, request.cursor.id);
  }

  // THE visibility predicate, composed into the WHERE clause — never applied after the rows come
  // back. A post-filter would under-fill the page and turn the page size into an existence oracle.
  conditions.push(request.visibility.fragmentFor(spec.matterExpression));
  bindings.push(...request.visibility.bindings);

  const order = request.ascending ? "ASC" : "DESC";
  const sql =
    `SELECT ${spec.sortColumn} AS sort_key, ${spec.idColumn} AS row_id, ` +
    `${spec.linkIdExpression ?? spec.idColumn} AS link_id, ` +
    `${spec.matterExpression} AS matter_id, ${spec.kindExpression} AS kind, ` +
    `${spec.actorExpression} AS actor_user_id, ${spec.labelExpression} AS label, ` +
    `${spec.timeOfDayExpression ?? "NULL"} AS time_of_day, ` +
    `${spec.timeZoneExpression ?? "NULL"} AS time_zone ` +
    `FROM ${spec.from} ` +
    `WHERE ${conditions.join(" AND ")} ` +
    `ORDER BY ${spec.sortColumn} ${order}, ${spec.idColumn} ${order} ` +
    `LIMIT ?`;
  bindings.push(request.limit);
  return database.prepare(sql).bind(...bindings);
}

// The bounded select for a FIRM-anchored source — the one shape that composes no visible-matter
// predicate, because its rows have no matter to compose one over. It is deliberately a separate
// builder rather than an option on boundedSelect: a matter-anchored source CANNOT reach this code
// path by flipping a flag, and a firm-anchored source using it must sit on the reviewed allowlist
// the source-fitness pass asserts (see VisibilityAnchor in registry.ts). The LIMIT and the shared
// keyset predicate are composed exactly as boundedSelect composes them.
export interface BoundedFirmScopedSelectSpec {
  readonly request: SourceReadRequest;
  readonly from: string;
  readonly sortColumn: string;
  readonly idColumn: string;
  readonly kindExpression: string;
  readonly actorExpression: string;
  readonly labelExpression: string;
  // The wall-clock time of day this row falls at and the zone it is read in, as SQL expressions —
  // absent on a source whose rows have no hour, which projects NULL for both. It is the same class
  // of fact the sort key already is (when a thing happens, in the record's own terms) and carries
  // nothing about a case, which is why it rides a projection a title may not.
  readonly timeOfDayExpression?: string;
  readonly timeZoneExpression?: string;
  readonly conditions: readonly string[];
  readonly bindings: readonly unknown[];
}

export function boundedFirmScopedSelect(
  database: SqlDatabase,
  spec: BoundedFirmScopedSelectSpec,
): SqlStatement {
  const { request } = spec;
  const conditions: string[] = [...spec.conditions];
  const bindings: unknown[] = [...spec.bindings];

  if (request.cursor !== undefined) {
    const comparison = request.ascending ? ">" : "<";
    conditions.push(
      `(${spec.sortColumn} ${comparison} ? OR (${spec.sortColumn} = ? AND ${spec.idColumn} ${comparison} ?))`,
    );
    bindings.push(request.cursor.sortKey, request.cursor.sortKey, request.cursor.id);
  }

  // A windowless, cursorless read is still valid SQL: the bound is the LIMIT.
  if (conditions.length === 0) conditions.push("1 = 1");

  const order = request.ascending ? "ASC" : "DESC";
  const sql =
    `SELECT ${spec.sortColumn} AS sort_key, ${spec.idColumn} AS row_id, ` +
    `${spec.idColumn} AS link_id, NULL AS matter_id, ${spec.kindExpression} AS kind, ` +
    `${spec.actorExpression} AS actor_user_id, ${spec.labelExpression} AS label, ` +
    `${spec.timeOfDayExpression ?? "NULL"} AS time_of_day, ` +
    `${spec.timeZoneExpression ?? "NULL"} AS time_zone ` +
    `FROM ${spec.from} ` +
    `WHERE ${conditions.join(" AND ")} ` +
    `ORDER BY ${spec.sortColumn} ${order}, ${spec.idColumn} ${order} ` +
    `LIMIT ?`;
  bindings.push(request.limit);
  return database.prepare(sql).bind(...bindings);
}

// The civil-date window, applied to a source whose time column is a civil date. Both bounds are
// inclusive, which is what a person means by "the 1st to the 31st".
export function civilDateWindowConditions(
  sortColumn: string,
  fromDate: string | undefined,
  toDate: string | undefined,
): { conditions: string[]; bindings: unknown[] } {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (fromDate !== undefined) {
    conditions.push(`${sortColumn} >= ?`);
    bindings.push(fromDate);
  }
  if (toDate !== undefined) {
    conditions.push(`${sortColumn} <= ?`);
    bindings.push(toDate);
  }
  return { conditions, bindings };
}

// The civil-date window for a source whose rows can SPAN days, which is a different question.
//
// A row that runs from the 12th to the 16th is IN a window covering the 14th, and the plain window
// above says it is not: it compares both bounds against the start, so a three-day trial vanished
// from every window that did not contain its first day, and a firm reading Tuesday saw an empty
// column it was in fact spending in court. The lower bound therefore compares against the row's own
// END — a row is in the window when it starts before the window closes and ends after it opens —
// while the upper bound stays on the start, because a span that begins after the window closes is
// still outside it.
//
// `COALESCE` is what makes a row with no end behave exactly as it did: its end IS its start, so the
// predicate collapses to the plain one for every point-in-time row, which is almost all of them.
//
// This does NOT widen what a source may return beyond its window. It returns rows the window always
// should have held and never did.
export function spanningCivilDateWindowConditions(
  sortColumn: string,
  endColumn: string,
  fromDate: string | undefined,
  toDate: string | undefined,
): { conditions: string[]; bindings: unknown[] } {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (fromDate !== undefined) {
    conditions.push(`COALESCE(${endColumn}, ${sortColumn}) >= ?`);
    bindings.push(fromDate);
  }
  if (toDate !== undefined) {
    conditions.push(`${sortColumn} <= ?`);
    bindings.push(toDate);
  }
  return { conditions, bindings };
}

// The same window against an INSTANT column. A canonical instant begins with its own civil date, so
// the bounds are date-prefix comparisons and no zone has to be known inside the SQL — the upper
// bound compares against the date's last representable prefix so the whole of the closing day is in.
export function instantWindowConditions(
  sortColumn: string,
  fromDate: string | undefined,
  toDate: string | undefined,
): { conditions: string[]; bindings: unknown[] } {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (fromDate !== undefined) {
    conditions.push(`${sortColumn} >= ?`);
    bindings.push(`${fromDate}T00:00:00.000Z`);
  }
  if (toDate !== undefined) {
    conditions.push(`${sortColumn} <= ?`);
    bindings.push(`${toDate}T23:59:59.999Z`);
  }
  return { conditions, bindings };
}

// The projection every source shares: a reference, never a record. It carries identifiers, a kind, a
// sort key, the hour where the row has one, an actor where there is one, the source's DECLARED
// non-privileged label, and the deep link. Nothing else — no title, no subject line, no narrative,
// no name.
export function projectRow(
  sourceKey: string,
  linkFor: (row: TimelineRawRow) => string,
): (row: TimelineRawRow) => {
  sourceKey: string;
  kind: string;
  sortKey: string;
  rowId: string;
  matterId: string | null;
  actorUserId: string | null;
  label: string | null;
  link: string;
  timeOfDay: string | null;
  timeZone: string | null;
  title: null;
  typeText: null;
  facts: null;
} {
  return (row) => ({
    sourceKey,
    kind: row.kind,
    sortKey: row.sort_key,
    // Said in the record's own zone and never converted: the reader's surface names the zone where
    // it is not theirs, exactly as every other calendar surface does.
    timeOfDay: row.time_of_day ?? null,
    timeZone: row.time_zone ?? null,
    // Never described by the projection: the words come from `describe`, on a matter-scoped read.
    title: null,
    typeText: null,
    facts: null,
    rowId: row.row_id,
    matterId: row.matter_id,
    actorUserId: row.actor_user_id ?? null,
    label: row.label ?? null,
    link: linkFor(row),
  });
}

// The one place a source's DESCRIBE statement is assembled, so its properties are structural too:
//
//   1. The matter is BOUND here, not by the source. A description names rows of the one matter the
//      reader is standing in; a source cannot decline the binding, so it cannot describe across
//      matters however its own conditions are written.
//   2. The row ids are the page on screen — a bounded list the caller holds, never a scan — and the
//      LIMIT is that list's length, so a statement can never answer with more rows than it was
//      asked about.
//   3. The visible-matter predicate is composed before the LIMIT, exactly as the page read composes
//      it: a row the page could not show cannot be named either.
//
// Column and table names are code-supplied literals; every caller value arrives as a binding.
export interface DescribeSelectSpec {
  readonly request: DescribeRequest;
  readonly from: string;
  readonly idColumn: string;
  readonly matterExpression: string;
  // What the reader recognises the row by. Never NULL.
  readonly titleExpression: string;
  // The subsystem's own word for what the row is, or the literal NULL.
  readonly typeExpression: string;
  // The subsystem's own fields as a json_object(...) expression, or the literal NULL.
  readonly factsExpression: string;
  // Source-specific narrowing (a soft-delete exclusion), with `?` placeholders in binding order.
  readonly conditions?: readonly string[];
  readonly bindings?: readonly unknown[];
}

export function describeSelect(database: SqlDatabase, spec: DescribeSelectSpec): SqlStatement {
  const { request } = spec;
  if (request.rowIds.length === 0) {
    throw new Error("describeSelect: a description names at least one row; return [] instead");
  }
  const conditions: string[] = [`${spec.matterExpression} = ?`];
  const bindings: unknown[] = [request.matterId];
  conditions.push(`${spec.idColumn} IN (${request.rowIds.map(() => "?").join(", ")})`);
  bindings.push(...request.rowIds);
  conditions.push(...(spec.conditions ?? []));
  bindings.push(...(spec.bindings ?? []));
  conditions.push(request.visibility.fragmentFor(spec.matterExpression));
  bindings.push(...request.visibility.bindings);
  const sql =
    `SELECT ${spec.idColumn} AS row_id, ${spec.titleExpression} AS title, ` +
    `${spec.typeExpression} AS type_text, ${spec.factsExpression} AS facts_json ` +
    `FROM ${spec.from} ` +
    `WHERE ${conditions.join(" AND ")} ` +
    `LIMIT ?`;
  bindings.push(request.rowIds.length);
  return database.prepare(sql).bind(...bindings);
}

// The first line of a free-text column, for a record that has no name of its own: a note leads
// with its opening line, a time entry with the start of its narrative. Cut in SQL so the page
// never carries a whole body to show one line of it.
export function firstLineExpression(column: string): string {
  return (
    `CASE WHEN instr(${column}, char(10)) > 0 ` +
    `THEN substr(${column}, 1, instr(${column}, char(10)) - 1) ` +
    `ELSE substr(${column}, 1, 200) END`
  );
}

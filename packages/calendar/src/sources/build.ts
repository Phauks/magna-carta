import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { SourceReadRequest, TimelineRawRow } from "./registry.ts";

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
    `${spec.matterExpression} AS matter_id, ${spec.kindExpression} AS kind, ` +
    `${spec.actorExpression} AS actor_user_id, ${spec.labelExpression} AS label ` +
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
    `NULL AS matter_id, ${spec.kindExpression} AS kind, ` +
    `${spec.actorExpression} AS actor_user_id, ${spec.labelExpression} AS label ` +
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
// sort key, an actor where there is one, the source's DECLARED non-privileged label, and the deep
// link. Nothing else — no title, no subject line, no narrative, no name.
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
} {
  return (row) => ({
    sourceKey,
    kind: row.kind,
    sortKey: row.sort_key,
    rowId: row.row_id,
    matterId: row.matter_id,
    actorUserId: row.actor_user_id ?? null,
    label: row.label ?? null,
    link: linkFor(row),
  });
}

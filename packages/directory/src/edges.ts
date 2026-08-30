import {
  appendCursorPredicate,
  assemblePage,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DirectoryEdgeId,
  DirectoryOrganizationId,
  DirectoryPersonId,
} from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import { assertEntityExists, UnknownEntityError } from "./entity-kind.ts";
import { DIRECTORY_EDGE_CREATED_TOPIC } from "./topics.ts";
import { EDGE_TYPES, type EdgeType } from "./types.ts";

// The error thrown when a caller supplies an edge_type value that is not in the
// application-level catalog. The DB schema allows any non-empty string, so this
// is enforced in application code rather than a constraint.
export class InvalidEdgeTypeError extends Error {
  readonly code = "invalid-edge-type";
  constructor(edgeType: string) {
    super(`directory: unknown edge type: ${edgeType}`);
    this.name = "InvalidEdgeTypeError";
  }
}

export { UnknownEntityError };

// The caller-supplied fields for a new directed edge between two directory entities.
// Both from and to may be person or organization ids — the endpoint tables are distinct
// but the edge table treats them uniformly as opaque entity ids.
export interface CreateEdgeInput {
  // The source entity id (directoryPerson_ or directoryOrganization_ prefix).
  readonly from: DirectoryPersonId | DirectoryOrganizationId;
  // The target entity id (directoryPerson_ or directoryOrganization_ prefix).
  readonly to: DirectoryPersonId | DirectoryOrganizationId;
  // The relationship type. Must be one of the EdgeType catalog values.
  readonly edgeType: EdgeType;
  // An optional role qualifier for the edge (e.g. "principal", "director").
  readonly role: string | null;
  // An optional free-text note on the relationship.
  readonly note: string | null;
  // The instant from which this edge is effective. NULL means no lower bound.
  readonly validFrom: string | null;
  // The instant until which this edge is effective. NULL means currently active.
  readonly validTo: string | null;
}

// A typed edge row returned by readEdges. The id, both endpoint ids, the edge type, and
// the optional qualifier fields are projected directly from the directory_edge table.
export interface DirectoryEdge {
  readonly id: DirectoryEdgeId;
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly edgeType: EdgeType;
  readonly role: string | null;
  readonly note: string | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
}

// Creates a directed edge between two directory entities within an atomic batch that also
// writes the domain audit row. Validates:
// 1. edgeType is a member of the EdgeType catalog — throws InvalidEdgeTypeError (code:
//    "invalid-edge-type") if not.
// 2. Both from and to entities exist and are not soft-deleted — throws UnknownEntityError
//    (code: "unknown-entity") for the first missing or deleted endpoint found.
//
// The function does not enforce directionality semantics (e.g. corporate_parent implies a
// direction); callers are responsible for passing endpoints in the intended order.
export async function createEdge(
  database: BatchDatabase,
  input: CreateEdgeInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryEdgeId> {
  // Validate the edge type against the application-level catalog before hitting the DB.
  if (!(EDGE_TYPES as readonly string[]).includes(input.edgeType)) {
    throw new InvalidEdgeTypeError(input.edgeType);
  }

  // Verify both endpoints exist and are not soft-deleted. The check is eager so a
  // bad caller gets a clear error before any write is attempted.
  await assertEntityExists(database, input.from);
  await assertEntityExists(database, input.to);

  const edgeId = newIdentifier("directoryEdge", options.randomSource);
  const now = options.clock.now();

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      database
        .prepare(
          `INSERT INTO directory_edge (id, from_entity_id, to_entity_id, edge_type, role, note, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, NULL)`,
        )
        .bind(
          edgeId,
          input.from,
          input.to,
          input.edgeType,
          input.role,
          input.note,
          input.validFrom,
          input.validTo,
          now,
        ),
      directoryAuditStatement(database, options, "directory.edge.created", edgeId),
    ],
    // One outbox row, in the batch this write was already composing. A relationship recorded after a
    // matter was screened — the corporate parent found later, the spouse, the principal-of link — is
    // a change in what a search would reach, so it is announced here and resolved off the hot path.
    // Both endpoints and the type travel with it: which matters are affected depends on all three.
    outboxMessages: [
      {
        topic: DIRECTORY_EDGE_CREATED_TOPIC,
        payload: {
          edgeId,
          fromEntityId: input.from,
          toEntityId: input.to,
          edgeType: input.edgeType,
        },
      },
    ],
    responseCode: 201,
    responseBody: { id: edgeId },
    value: edgeId,
    fromBody: (body) => (body as { id: DirectoryEdgeId }).id,
  }));
}

// Returns all active edges where the given entity is either the from or to endpoint.
// Active means: not soft-deleted (deleted_at IS NULL) and temporally current (valid_to IS NULL
// or valid_to is in the future relative to the ISO-8601 string stored in the column). Because
// SQLite compares ISO-8601 strings lexicographically and the timestamps are stored in that
// format, a string comparison with the current instant is correct.
//
// Temporal note: edges with a future valid_from are included — the active predicate is only
// about the upper bound (expiry), not the lower bound (effective date). This matches the
// read-all-current pattern used for conflict checking, where knowing that a relationship will
// exist is as important as knowing it exists now.
// How the caller wants the temporal upper bound applied. Omitting the whole options object preserves
// the shipped behaviour exactly — expiry judged against an ambient `new Date()`, expired edges left
// out — so every existing caller is untouched.
export interface ReadEdgesOptions {
  // The instant expiry is judged against. Supply the caller's own clock rather than letting the read
  // take an ambient `new Date()`: two reads inside one operation must not disagree about whether an
  // edge had expired, and a test cannot pin a wall-clock read.
  readonly asOf?: string;
  // Return edges whose `valid_to` has already passed as well as current ones. The conflicts traversal
  // wants them — the professional-conduct rules are about FORMER clients and FORMER relationships, so
  // a search that stopped at currency would drop the dimension they care most about — and it marks
  // each expired step on the path it records so a reviewer weighs it. Ordinary reads do not.
  readonly includeExpired?: boolean;
}

function toDirectoryEdge(row: {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  edge_type: string;
  role: string | null;
  note: string | null;
  valid_from: string | null;
  valid_to: string | null;
}): DirectoryEdge {
  return {
    id: row.id as DirectoryEdgeId,
    fromEntityId: row.from_entity_id,
    toEntityId: row.to_entity_id,
    edgeType: row.edge_type as EdgeType,
    role: row.role,
    note: row.note,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  };
}

const EDGE_COLUMNS = `id, from_entity_id, to_entity_id, edge_type, role, note, valid_from, valid_to`;

export async function readEdges(
  database: BatchDatabase,
  entityId: DirectoryPersonId | DirectoryOrganizationId,
  options: ReadEdgesOptions = {},
): Promise<DirectoryEdge[]> {
  const asOf = options.asOf ?? new Date().toISOString();
  const expiryFilter =
    options.includeExpired === true ? "" : "AND (valid_to IS NULL OR valid_to > ?2)";
  const { results } = await database
    .prepare(
      `SELECT ${EDGE_COLUMNS} FROM directory_edge WHERE (from_entity_id = ?1 OR to_entity_id = ?1) AND deleted_at IS NULL ${expiryFilter}`,
    )
    .bind(entityId, asOf)
    .all<Parameters<typeof toDirectoryEdge>[0]>();

  return results.map(toDirectoryEdge);
}

// D1 caps bound parameters at 100 per query, so a set-valued read chunks rather than composing one
// oversized IN list. Mirrors `MAX_BOUND_PARAMETERS` in packages/ledger/src/statements.ts, restated
// here rather than imported so the Directory does not take a dependency on the ledger for a platform
// constant.
const MAX_EDGE_BOUND_PARAMETERS = 100;

// Every active edge touching ANY of the given entities, in one read per chunk rather than one read
// per entity. The conflicts traversal walks a frontier at a time, and a per-entity read there is a
// query count that scales with the corpus instead of with the shape of the walk.
//
// Returned as a map from the queried entity id to its edges. An edge whose two endpoints are both in
// the set appears under both, exactly as two separate `readEdges` calls would have returned it.
export async function readEdgesForEntities(
  database: BatchDatabase,
  entityIds: readonly string[],
  options: ReadEdgesOptions = {},
): Promise<Map<string, DirectoryEdge[]>> {
  const byEntityId = new Map<string, DirectoryEdge[]>();
  for (const entityId of entityIds) byEntityId.set(entityId, []);
  const unique = [...byEntityId.keys()];
  if (unique.length === 0) return byEntityId;

  const asOf = options.asOf ?? new Date().toISOString();
  for (let start = 0; start < unique.length; start += MAX_EDGE_BOUND_PARAMETERS) {
    const chunk = unique.slice(start, start + MAX_EDGE_BOUND_PARAMETERS);
    const bindings: unknown[] = [...chunk];
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    let expiryFilter = "";
    if (options.includeExpired !== true) {
      bindings.push(asOf);
      expiryFilter = `AND (valid_to IS NULL OR valid_to > ?${bindings.length})`;
    }
    const { results } = await database
      .prepare(
        `SELECT ${EDGE_COLUMNS} FROM directory_edge
          WHERE (from_entity_id IN (${placeholders}) OR to_entity_id IN (${placeholders}))
            AND deleted_at IS NULL ${expiryFilter}`,
      )
      // The two IN lists reuse the SAME positional placeholders, so the chunk is bound once.
      .bind(...bindings)
      .all<Parameters<typeof toDirectoryEdge>[0]>();

    for (const row of results) {
      const edge = toDirectoryEdge(row);
      byEntityId.get(edge.fromEntityId)?.push(edge);
      // A self-loop would otherwise be listed twice under the one entity.
      if (edge.toEntityId !== edge.fromEntityId) byEntityId.get(edge.toEntityId)?.push(edge);
    }
  }
  return byEntityId;
}

// ── one entity's edges, paged ────────────────────────────────────────────────

/**
 * Every active edge touching one entity, newest first and cursor-paged.
 *
 * The unpaged `readEdges` above stays exactly as it is: the conflicts traversal wants the whole
 * neighbourhood of a node in one call and reads it with a bounded frontier, and paging it would turn
 * one query into a loop inside a graph walk. This is the HTTP-shaped twin — a screen renders a page
 * of relationships and a firm that has recorded a corporate group's whole structure against one
 * holding company has a neighbourhood no response should try to carry whole.
 *
 * Direction is preserved rather than normalized away: an edge from this entity and an edge to it
 * mean opposite things ("parent of" is not "subsidiary of"), so the caller is told which end this
 * entity is on and renders the relationship accordingly.
 */
export async function readEdgesPage(
  database: BatchDatabase,
  entityId: DirectoryPersonId | DirectoryOrganizationId,
  options: ReadEdgesOptions & { readonly cursor?: string; readonly pageSize?: number } = {},
): Promise<Page<DirectoryEdge>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const asOf = options.asOf ?? new Date().toISOString();
  const conditions = ["(from_entity_id = ?1 OR to_entity_id = ?1)", "deleted_at IS NULL"];
  const bindings: unknown[] = [entityId];
  if (options.includeExpired !== true) {
    bindings.push(asOf);
    conditions.push(`(valid_to IS NULL OR valid_to > ?${String(bindings.length)})`);
  }
  appendCursorPredicate(conditions, bindings, decodeCursor(options.cursor));
  bindings.push(pageSize + 1);

  const { results } = await database
    .prepare(
      `SELECT ${EDGE_COLUMNS}, created_at FROM directory_edge
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ?${String(bindings.length)}`,
    )
    .bind(...bindings)
    .all<Parameters<typeof toDirectoryEdge>[0] & { created_at: string }>();

  return assemblePage(results, pageSize, toDirectoryEdge);
}

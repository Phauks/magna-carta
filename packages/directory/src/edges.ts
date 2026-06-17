import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DirectoryEdgeId,
  DirectoryOrganizationId,
  DirectoryPersonId,
} from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.js";
import { entityKindFromId } from "./entity-kind.js";
import { EDGE_TYPES, type EdgeType } from "./types.js";

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

// The error thrown when either endpoint of an edge does not exist in the directory
// or has been soft-deleted. Hard-deletion of directory entities is not permitted;
// soft-deletion sets deleted_at.
export class UnknownEntityError extends Error {
  readonly code = "unknown-entity";
  constructor(entityId: string) {
    super(`directory: entity not found or soft-deleted: ${entityId}`);
    this.name = "UnknownEntityError";
  }
}

// Check that a single endpoint entity exists and is not soft-deleted. Looks in the
// correct node table based on the entity id prefix. Throws UnknownEntityError if
// the entity is missing or has a non-null deleted_at.
async function assertEntityExists(database: BatchDatabase, entityId: string): Promise<void> {
  const kind = entityKindFromId(entityId);
  const table = kind === "person" ? "directory_person" : "directory_organization";
  const { results } = await database
    .prepare(`SELECT id FROM ${table} WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(entityId)
    .all<{ id: string }>();
  if (results.length === 0) throw new UnknownEntityError(entityId);
}

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

  const statements: SqlStatement[] = [
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
  ];

  await commitEffectBatch(database, { statements, outboxMessages: [] }, { now: () => now });

  return edgeId;
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
export async function readEdges(
  database: BatchDatabase,
  entityId: DirectoryPersonId | DirectoryOrganizationId,
): Promise<DirectoryEdge[]> {
  const now = new Date().toISOString();
  const { results } = await database
    .prepare(
      `SELECT id, from_entity_id, to_entity_id, edge_type, role, note, valid_from, valid_to FROM directory_edge WHERE (from_entity_id = ?1 OR to_entity_id = ?1) AND deleted_at IS NULL AND (valid_to IS NULL OR valid_to > ?2)`,
    )
    .bind(entityId, now)
    .all<{
      id: string;
      from_entity_id: string;
      to_entity_id: string;
      edge_type: string;
      role: string | null;
      note: string | null;
      valid_from: string | null;
      valid_to: string | null;
    }>();

  return results.map((row) => ({
    id: row.id as DirectoryEdgeId,
    fromEntityId: row.from_entity_id,
    toEntityId: row.to_entity_id,
    edgeType: row.edge_type as EdgeType,
    role: row.role,
    note: row.note,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  }));
}

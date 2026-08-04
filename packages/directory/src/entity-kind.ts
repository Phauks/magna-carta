import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EntityKind } from "./types.ts";

// Determine whether an entity id belongs to a person or an organization by inspecting the handle
// prefix. Identifiers are self-describing: the prefix is the entity type spelled out in full,
// separated from the random token by a single underscore. "directoryPerson_..." starts with
// "directoryPerson_"; "directoryOrganization_..." starts with "directoryOrganization_".
export function entityKindFromId(entityId: string): EntityKind {
  if (entityId.startsWith("directoryPerson_")) return "person";
  if (entityId.startsWith("directoryOrganization_")) return "organization";
  throw new Error(
    `directory: entity id does not start with a known directory entity prefix: ${entityId}`,
  );
}

// The node table each entity kind lives in. The one home for the kind→table mapping; every site that
// needs the physical table for an entity id derives it from here rather than re-deriving the prefix.
export const NODE_TABLE: Readonly<Record<EntityKind, string>> = {
  person: "directory_person",
  organization: "directory_organization",
};

// The node table an entity id addresses, resolved from its handle prefix. Reused by the merge repoint,
// the candidate-channel merged-id resolution, and the existence check below.
export function nodeTableForEntityId(entityId: string): string {
  return NODE_TABLE[entityKindFromId(entityId)];
}

// The error thrown when a caller supplies an entity id that does not exist in the directory
// or has been soft-deleted. Hard-deletion of directory entities is not permitted;
// soft-deletion sets deleted_at.
export class UnknownEntityError extends Error {
  readonly code = "unknown-entity";
  constructor(entityId: string) {
    super(`directory: entity not found or soft-deleted: ${entityId}`);
    this.name = "UnknownEntityError";
  }
}

// The error thrown when a caller aims a WRITE at an entity that has been merged away. The entity is
// not missing — reads still return it, carrying merged_into_id so a client can follow the pointer —
// so this is a conflict, not a 404, and it names the surviving master the caller should write to
// instead. Refusing rather than silently redirecting keeps the write auditable: an alias, identifier,
// edge, or matter-party link must never land on an entity the caller did not name.
export class MergedEntityError extends Error {
  readonly code = "entity-merged";
  readonly entityId: string;
  readonly masterId: string;
  constructor(entityId: string, masterId: string) {
    super(
      `directory: entity ${entityId} was merged into ${masterId}; write to the surviving master instead (entity-merged)`,
    );
    this.name = "MergedEntityError";
    this.entityId = entityId;
    this.masterId = masterId;
  }
}

// Check that a single entity exists, is not soft-deleted, and is still LIVE — i.e. has not been merged
// away into another entity. Looks in the correct node table based on the entity id prefix. Throws
// UnknownEntityError when the row is missing or carries a non-null deleted_at, and MergedEntityError
// when the row is a merge subordinate (status 'merged_into'). Status is part of existence for a write:
// a merged-away node keeps its rows for the search/conflicts corpus but is no longer a place new data
// may be attached, and every inbound reference has already moved to the master.
export async function assertEntityExists(database: BatchDatabase, entityId: string): Promise<void> {
  const table = nodeTableForEntityId(entityId);
  const { results } = await database
    .prepare(`SELECT id, status, merged_into_id FROM ${table} WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(entityId)
    .all<{ id: string; status: string; merged_into_id: string | null }>();
  const row = results[0];
  if (row === undefined) throw new UnknownEntityError(entityId);
  if (row.status === "merged_into") {
    throw new MergedEntityError(entityId, row.merged_into_id ?? "");
  }
}

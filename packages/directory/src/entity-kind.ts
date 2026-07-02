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

// Check that a single entity exists and is not soft-deleted. Looks in the correct node table
// based on the entity id prefix. Throws UnknownEntityError if the entity is missing or has a
// non-null deleted_at.
export async function assertEntityExists(database: BatchDatabase, entityId: string): Promise<void> {
  const table = nodeTableForEntityId(entityId);
  const { results } = await database
    .prepare(`SELECT id FROM ${table} WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(entityId)
    .all<{ id: string }>();
  if (results.length === 0) throw new UnknownEntityError(entityId);
}

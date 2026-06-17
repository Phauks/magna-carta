import type { EntityKind } from "./types.js";

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

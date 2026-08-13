// The outbox topics this package publishes, as one frozen set.
//
// They were literals at their write sites until something subscribed to them. A subscriber that
// spells a topic itself is a subscriber that can spell it differently — and the failure mode is
// silent, because an unrecognized topic on the per-firm bus is acked and ignored by design, so a
// typo does not throw, it just quietly stops delivering. Naming them once here makes the producer
// and every consumer share one spelling, and makes "does this topic exist" a compile-time question.
// Same shape as packages/matters/src/topics.ts, for the same reason.
//
// Every one of these is emitted as EXACTLY ONE outbox row inside the atomic batch its write path was
// already composing. No producer here reads anything extra to build its payload, and no payload
// carries an identifier VALUE — the identifier topic names the identifier row and its type, never
// what was sealed into it.

// A directory person or organization was created. Deliberately NOT a conflicts re-check cause on its
// own: a new entity cannot change an already-checked matter's answer until something links it to a
// matter or connects it by an edge, and firing on creation would make a two-thousand-row contact
// import re-check a firm's entire open caseload for no possible new hit.
export const DIRECTORY_ENTITY_CREATED_TOPIC = "directory.entity.created";

// A new current name landed on an entity (append-and-flip). A new alias, maiden, former, or DBA row
// makes name matches possible that were not possible before.
export const DIRECTORY_ENTITY_RENAMED_TOPIC = "directory.entity.renamed";

// Two entities became one. The payload names the surviving master AND the archived subordinate,
// because a matter that named either of them is affected and only the pair identifies which.
export const DIRECTORY_ENTITY_MERGED_TOPIC = "directory.entity.merged";

// A typed edge was recorded between two entities — the corporate parent discovered later, the spouse
// recorded later, the principal-of link added later. The payload names both endpoints and the type.
export const DIRECTORY_EDGE_CREATED_TOPIC = "directory.edge.created";

// A sealed identifier was attached to an entity. The payload names the entity and the identifier
// TYPE — never a value, never the blind index, which is exactly what makes the row safe to relay.
export const DIRECTORY_IDENTIFIER_ADDED_TOPIC = "directory.identifier.added";

// An entity was linked to a matter in a role. The role change the model expresses as
// unlink-then-link arrives here too, as the link half.
export const MATTER_PARTY_LINKED_TOPIC = "matter_party.linked";

export const DIRECTORY_OUTBOX_TOPICS = Object.freeze([
  DIRECTORY_ENTITY_CREATED_TOPIC,
  DIRECTORY_ENTITY_RENAMED_TOPIC,
  DIRECTORY_ENTITY_MERGED_TOPIC,
  DIRECTORY_EDGE_CREATED_TOPIC,
  DIRECTORY_IDENTIFIER_ADDED_TOPIC,
  MATTER_PARTY_LINKED_TOPIC,
] as const);

export type DirectoryOutboxTopic = (typeof DIRECTORY_OUTBOX_TOPICS)[number];

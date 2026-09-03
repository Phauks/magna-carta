/*
 * EntityIdentity — the one mark for a person or an organization wherever one is named: a directory
 * row, a party on a matter, a payee on a cost, a chip in a picker. Exported as a single component
 * rather than the house namespace shape because it has no parts to compose: a caller hands it a name
 * and the facts about the record, and the mark reads the same everywhere, which is the whole reason it
 * exists — two surfaces that assemble an entity differently make a reader work out whether they are
 * looking at one record or two.
 */
export { default } from "./entity-identity.svelte";
export { default as EntityIdentity } from "./entity-identity.svelte";
export type { EntityIdentitySize, EntityKind } from "./types.ts";
export { entityKindLabel } from "./entity-kind-label.ts";

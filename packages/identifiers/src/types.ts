import type { EntityType } from "./registry.ts";

// Branded handle strings. The brand is keyed by the entity literal over one symbol, so Identifier<"matter">
// and Identifier<"document"> are mutually non-assignable. Brands are compile-time only — erased at runtime,
// so they cost nothing on the wire. A branded id IS assignable to string (it flows into DB values and URLs);
// a raw string is NOT assignable to a branded id without going through validate.ts.
declare const identifierBrand: unique symbol;

export type Identifier<T extends EntityType> = string & { readonly [identifierBrand]: T };

// The brand for a given entity type — the return type of newIdentifier(type) and the narrowed type of a
// validated handle. Trivial here because the brand already keys off the entity literal.
export type BrandFor<T extends EntityType> = Identifier<T>;

// Any identifier, regardless of entity type — for code that handles handles polymorphically.
export type AnyIdentifier = Identifier<EntityType>;

// Named aliases — one per registry entry (golden rule 12: spelled out). Keep in sync with ENTITY_PREFIXES.
export type MatterId = Identifier<"matter">;
export type DocumentId = Identifier<"document">;
export type DirectoryId = Identifier<"directory">;
export type InvoiceId = Identifier<"invoice">;
export type EventId = Identifier<"event">;
export type PortalGrantId = Identifier<"portalGrant">;
export type LedgerEntryId = Identifier<"ledgerEntry">;
export type OutboxId = Identifier<"outbox">;
export type IdempotencyRecordId = Identifier<"idempotencyRecord">;
export type UserId = Identifier<"user">;
export type FirmId = Identifier<"firm">;

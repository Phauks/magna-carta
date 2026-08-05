import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryPartyRoleId, MatterPartyId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import { assertEntityExists } from "./entity-kind.ts";
import { insertMatterPartyStatement } from "./statements.ts";

// The caller-supplied fields for linking a directory entity to a matter in a role. The role is a
// free-text value (e.g. 'client', 'opposing_party', 'guardian') — directory_party_role is the catalog
// a UI lists from, but matter_party.role is not constrained to it, so an ad-hoc role still links.
export interface LinkMatterPartyInput {
  readonly matterId: string;
  readonly entityId: string;
  readonly role: string;
}

// One party row read back from a matter — the link id, the entity it points at, and the role it
// plays. One entity can wear several hats on the same matter (one row per role).
export interface MatterPartyRow {
  readonly id: string;
  readonly matterId: string;
  readonly entityId: string;
  readonly role: string;
}

// Links a directory entity to a matter in a role within an atomic batch that also writes the domain
// audit row. Many-hats is supported by design: the same entity linked as both 'client' and 'guardian'
// produces two rows — there is no uniqueness on (matter, entity), only the per-row role.
export async function linkMatterParty(
  database: BatchDatabase,
  input: LinkMatterPartyInput,
  options: DirectoryWriteOptions,
): Promise<MatterPartyId> {
  // Fail fast before any side effects: reject a missing or soft-deleted entity.
  await assertEntityExists(database, input.entityId);

  const matterPartyId = newIdentifier("matterParty", options.randomSource);
  const now = options.clock.now();

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      insertMatterPartyStatement(database, {
        id: matterPartyId,
        matterId: input.matterId,
        entityId: input.entityId,
        role: input.role,
        createdAt: now,
      }),
      directoryAuditStatement(database, options, "directory.matter_party.linked", matterPartyId),
    ],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: matterPartyId },
    value: matterPartyId,
    fromBody: (body) => (body as { id: MatterPartyId }).id,
  }));
}

// Returns the live (non-soft-deleted) parties on a matter, ordered for a stable read.
export async function readMatterParties(
  database: BatchDatabase,
  matterId: string,
): Promise<MatterPartyRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, entity_id, role FROM matter_party WHERE matter_id = ?1 AND deleted_at IS NULL ORDER BY role ASC, id ASC`,
    )
    .bind(matterId)
    .all<{ id: string; matter_id: string; entity_id: string; role: string }>();

  return results.map((row) => ({
    id: row.id,
    matterId: row.matter_id,
    entityId: row.entity_id,
    role: row.role,
  }));
}

// One correspondent's address matched to a matter it plays a role on.
export interface MatterPartyAddressMatch {
  readonly matterId: string;
  readonly entityId: string;
  readonly role: string;
  // The normalized form of the address that matched, so a caller can say WHICH correspondent tied the
  // message to the matter rather than just that one did.
  readonly normalizedAddress: string;
}

// The reverse of readMatterParties over a set of email addresses: given the correspondents on a piece
// of mail, which matters are any of them a party on? This is the bridge that lets email capture
// propose a matter from who is talking, and it is one statement rather than a lookup per address —
// directory_email_normalized_address_index selects the entities, matter_party_entity_id_index selects
// their matters.
//
// A merged-away entity needs no special handling here: a merge repoints matter_party.entity_id onto
// the surviving master, so a subordinate's contact row resolves to the master's matters through the
// join itself.
export async function readMatterPartiesForEmailAddresses(
  database: BatchDatabase,
  normalizedAddresses: readonly string[],
): Promise<MatterPartyAddressMatch[]> {
  if (normalizedAddresses.length === 0) return [];
  const placeholders = normalizedAddresses.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT matter_party.matter_id AS matter_id,
              matter_party.entity_id AS entity_id,
              matter_party.role AS role,
              directory_email.normalized_address AS normalized_address
       FROM directory_email
       JOIN matter_party ON matter_party.entity_id = directory_email.entity_id
       WHERE directory_email.normalized_address IN (${placeholders})
         AND directory_email.deleted_at IS NULL
         AND matter_party.deleted_at IS NULL
       ORDER BY matter_party.matter_id ASC, matter_party.role ASC, matter_party.id ASC`,
    )
    .bind(...normalizedAddresses)
    .all<{
      matter_id: string;
      entity_id: string;
      role: string;
      normalized_address: string | null;
    }>();

  return results.flatMap((row) =>
    row.normalized_address === null
      ? []
      : [
          {
            matterId: row.matter_id,
            entityId: row.entity_id,
            role: row.role,
            normalizedAddress: row.normalized_address,
          },
        ],
  );
}

// The caller-supplied fields for a new party role (the catalog a UI lists matter roles from).
export interface CreatePartyRoleInput {
  readonly name: string;
  // Display order among roles. Defaults to 0 when omitted.
  readonly position?: number;
}

// The row shape returned by listPartyRoles.
export interface PartyRoleRow {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly archived: number;
}

// Creates a party role in the catalog within an atomic batch that also writes the domain audit row.
// The id is minted with the "directoryPartyRole" prefix; position defaults to 0.
export async function createPartyRole(
  database: BatchDatabase,
  input: CreatePartyRoleInput,
  options: DirectoryWriteOptions,
): Promise<{ id: DirectoryPartyRoleId }> {
  const partyRoleId = newIdentifier("directoryPartyRole", options.randomSource);
  const position = input.position ?? 0;

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      database
        .prepare(
          `INSERT INTO directory_party_role (id, name, archived, position) VALUES (?1, ?2, 0, ?3)`,
        )
        .bind(partyRoleId, input.name, position),
      directoryAuditStatement(database, options, "directory.party_role.created", partyRoleId),
    ],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: partyRoleId },
    value: { id: partyRoleId },
    fromBody: (body) => ({ id: (body as { id: DirectoryPartyRoleId }).id }),
  }));
}

// Returns the non-archived party roles ordered by display position.
export async function listPartyRoles(database: BatchDatabase): Promise<PartyRoleRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, name, position, archived FROM directory_party_role WHERE archived = 0 ORDER BY position ASC, name ASC`,
    )
    .all<{ id: string; name: string; position: number; archived: number }>();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    archived: row.archived,
  }));
}

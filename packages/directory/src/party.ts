import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryPartyRoleId, MatterPartyId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.js";

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
  const matterPartyId = newIdentifier("matterParty", options.randomSource);
  const now = options.clock.now();

  const statements: SqlStatement[] = [
    database
      .prepare(
        `INSERT INTO matter_party (id, matter_id, entity_id, role, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?5, NULL)`,
      )
      .bind(matterPartyId, input.matterId, input.entityId, input.role, now),
    directoryAuditStatement(database, options, "directory.matter_party.linked", matterPartyId),
  ];

  await commitEffectBatch(database, { statements, outboxMessages: [] }, { now: () => now });

  return matterPartyId;
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
  const now = options.clock.now();
  const position = input.position ?? 0;

  const statements: SqlStatement[] = [
    database
      .prepare(
        `INSERT INTO directory_party_role (id, name, archived, position) VALUES (?1, ?2, 0, ?3)`,
      )
      .bind(partyRoleId, input.name, position),
    directoryAuditStatement(database, options, "directory.party_role.created", partyRoleId),
  ];

  await commitEffectBatch(database, { statements, outboxMessages: [] }, { now: () => now });

  return { id: partyRoleId };
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

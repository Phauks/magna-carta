import {
  assemblePage,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryPartyRoleId, MatterPartyId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import { assertEntityExists } from "./entity-kind.ts";
import { insertMatterPartyStatement, softDeleteMatterPartyStatement } from "./statements.ts";
import { MATTER_PARTY_LINKED_TOPIC } from "./topics.ts";

// The caller-supplied fields for linking a directory entity to a matter in a role. The role is a
// free-text value (e.g. 'client', 'opposing_party', 'guardian') — directory_party_role is the catalog
// a UI lists from, but matter_party.role is not constrained to it, so an ad-hoc role still links.
export interface LinkMatterPartyInput {
  readonly matterId: string;
  readonly entityId: string;
  readonly role: string;
  // The capacity the entity acts in on this matter — "Administrator", "Trustee",
  // "Attorney-in-fact". A fact about the LINK, not the entity: the same person is an administrator
  // on one matter and a beneficiary on the next. Recorded by the firm, never inferred; documents
  // that name a capacity read this column and report an honest absence where none was recorded.
  readonly capacity?: string | null;
}

// One party row read back from a matter — the link id, the entity it points at, and the role it
// plays. One entity can wear several hats on the same matter (one row per role).
export interface MatterPartyRow {
  readonly id: string;
  readonly matterId: string;
  readonly entityId: string;
  readonly role: string;
  // The capacity recorded on THIS link — "Administrator", "Trustee", "Attorney-in-fact" — or null
  // where the firm recorded none. linkMatterParty has always written this column and this row type
  // did not carry it, so every caller reading a party through here saw an absence that was not real.
  readonly capacity: string | null;
  // Which side of the directory the entity id resolves to, or "unknown" when it resolves to neither
  // — a soft-deleted entity a link still points at. Never guessed from the id's prefix: the prefix
  // says what was minted, the join says what is still there.
  readonly entityKind: "person" | "organization" | "unknown";
  // What to call the entity on screen, or null when the directory holds no name for it. A caller
  // showing a party renders the id itself in that case rather than inventing a placeholder.
  readonly displayName: string | null;
}

// The stored display name wins where the firm set one. Otherwise a person's name is composed from
// the parts, which is the only other place a name exists — a person created through the API always
// has given/family and may never get a display_name written.
function partyDisplayName(row: {
  display_name: string | null;
  name_given: string | null;
  name_family: string | null;
  legal_name: string | null;
}): string | null {
  if (row.display_name !== null && row.display_name !== "") return row.display_name;
  if (row.legal_name !== null && row.legal_name !== "") return row.legal_name;
  const composed = [row.name_given, row.name_family].filter((part) => part !== null && part !== "");
  return composed.length === 0 ? null : composed.join(" ");
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
        capacity: input.capacity ?? null,
        createdAt: now,
      }),
      directoryAuditStatement(database, options, "directory.matter_party.linked", matterPartyId),
    ],
    // One outbox row, in the batch this write was already composing — no extra read, no fan-out, no
    // traversal on the request path. A party added to a matter months after it was screened is the
    // plainest way an honest conflicts answer goes stale, so the link has to be announced; resolving
    // what that means for any matter happens in a queue consumer, never here.
    outboxMessages: [
      {
        topic: MATTER_PARTY_LINKED_TOPIC,
        payload: { matterPartyId, matterId: input.matterId, entityId: input.entityId },
      },
    ],
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
      `SELECT matter_party.id AS id,
              matter_party.matter_id AS matter_id,
              matter_party.entity_id AS entity_id,
              matter_party.role AS role,
              matter_party.capacity AS capacity,
              directory_person.display_name AS person_display_name,
              directory_person.name_given AS name_given,
              directory_person.name_family AS name_family,
              directory_organization.display_name AS organization_display_name,
              directory_organization.legal_name AS legal_name,
              CASE
                WHEN directory_person.id IS NOT NULL THEN 'person'
                WHEN directory_organization.id IS NOT NULL THEN 'organization'
                ELSE 'unknown'
              END AS entity_kind
         FROM matter_party
         LEFT JOIN directory_person
                ON directory_person.id = matter_party.entity_id AND directory_person.deleted_at IS NULL
         LEFT JOIN directory_organization
                ON directory_organization.id = matter_party.entity_id AND directory_organization.deleted_at IS NULL
        WHERE matter_party.matter_id = ?1 AND matter_party.deleted_at IS NULL
        ORDER BY matter_party.role ASC, matter_party.id ASC`,
    )
    .bind(matterId)
    .all<{
      id: string;
      matter_id: string;
      entity_id: string;
      role: string;
      capacity: string | null;
      person_display_name: string | null;
      name_given: string | null;
      name_family: string | null;
      organization_display_name: string | null;
      legal_name: string | null;
      entity_kind: "person" | "organization" | "unknown";
    }>();

  return results.map((row) => ({
    id: row.id,
    matterId: row.matter_id,
    entityId: row.entity_id,
    role: row.role,
    capacity: row.capacity,
    entityKind: row.entity_kind,
    displayName: partyDisplayName({
      display_name: row.person_display_name ?? row.organization_display_name,
      name_given: row.name_given,
      name_family: row.name_family,
      legal_name: row.legal_name,
    }),
  }));
}

// Severs one party link by soft-deleting it, in the same atomic batch as its audit row.
//
// Soft delete rather than a row removal because the link is evidence: a conflicts report run last
// month named the parties as they stood, and a hard delete would make that report unreproducible.
// Every reader already filters deleted_at, so a severed link disappears from the live set the moment
// this commits.
//
// Deliberately publishes no outbox message, where the link half publishes one. The link half has to
// announce itself because adding a party can make a previously clean matter conflict, and a stale
// clean answer is the dangerous direction. Removing a party can only ever retract a hit — it adds no
// edge to the graph, so no matter's answer can turn from clean to conflicted because of it. A report
// that still shows a retracted hit is a false positive, which is the safe way to be wrong.
//
// Returns false when no live link carried the id — already severed, or never existed. Those two are
// indistinguishable to a caller and neither is an error, so one answer covers both.
//
// The liveness read has to happen HERE rather than being inferred from the write: the effect runner
// reports the value this function hands it, not the row count the statement changed, so a guarded
// UPDATE that matches nothing still returns whatever it was told to. Reading first also keeps a
// no-op sever out of the audit log, which is right — nothing happened, so nothing is recorded.
//
// The read and the write are not atomic with each other. Behind the per-firm database's Durable
// Object the two severs are serialized anyway, and the statement's own deleted_at IS NULL guard is
// what protects the recorded instant; the worst concurrent outcome is a second audit row for a
// sever that had already landed, never a rewritten timestamp.
export async function unlinkMatterParty(
  database: BatchDatabase,
  matterPartyId: MatterPartyId,
  options: DirectoryWriteOptions,
): Promise<boolean> {
  const now = options.clock.now();

  const { results } = await database
    .prepare(`SELECT id FROM matter_party WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(matterPartyId)
    .all<{ id: string }>();
  if (results.length === 0) return false;

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      softDeleteMatterPartyStatement(database, { id: matterPartyId, deletedAt: now }),
      directoryAuditStatement(database, options, "directory.matter_party.unlinked", matterPartyId),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: { unlinked: true },
    value: true,
    fromBody: (body) => (body as { unlinked: boolean }).unlinked,
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

// ── the matters one entity is a party to ─────────────────────────────────────

/**
 * One matter an entity is a party to — the link, the role it plays there, and enough of the matter
 * to name it on screen.
 *
 * The mirror image of readMatterParties: that one answers "who is on this matter", this one answers
 * "what is this person on". Both read the same rows through the same index — `matter_party` carries
 * an index on each side precisely so neither direction is a scan.
 */
export interface EntityMatterPartyRow {
  readonly id: string;
  readonly matterId: string;
  readonly role: string;
  readonly capacity: string | null;
  /** The matter's title, or null when the link points at a matter the firm no longer holds. */
  readonly matterTitle: string | null;
  /** The number the firm files it under, null while the matter is still prospective. */
  readonly matterNumber: string | null;
  readonly matterStatus: string | null;
  readonly linkedAt: string;
}

/**
 * The live matters this entity is a party to, newest link first and cursor-paged.
 *
 * Severed links are excluded, the same way the per-matter read excludes them: the row is retained so
 * a conflicts report that named this party stays reproducible, and every live read filters it out.
 */
export async function readMatterPartiesForEntity(
  database: BatchDatabase,
  entityId: string,
  options: { readonly cursor?: string; readonly pageSize?: number } = {},
): Promise<Page<EntityMatterPartyRow>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const conditions = ["matter_party.entity_id = ?1", "matter_party.deleted_at IS NULL"];
  const bindings: unknown[] = [entityId];
  // The keyset names the qualified columns because the statement joins: an unqualified created_at
  // would be ambiguous across matter_party and matter.
  const cursor = decodeCursor(options.cursor);
  if (cursor !== undefined) {
    conditions.push(
      "(matter_party.created_at < ? OR (matter_party.created_at = ? AND matter_party.id < ?))",
    );
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(pageSize + 1);

  const { results } = await database
    .prepare(
      `SELECT matter_party.id AS id,
              matter_party.matter_id AS matter_id,
              matter_party.role AS role,
              matter_party.capacity AS capacity,
              matter_party.created_at AS created_at,
              matter.title AS matter_title,
              matter.matter_number AS matter_number,
              matter.status AS matter_status
         FROM matter_party
         LEFT JOIN matter ON matter.id = matter_party.matter_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY matter_party.created_at DESC, matter_party.id DESC
        LIMIT ?${String(bindings.length)}`,
    )
    .bind(...bindings)
    .all<{
      id: string;
      matter_id: string;
      role: string;
      capacity: string | null;
      created_at: string;
      matter_title: string | null;
      matter_number: string | null;
      matter_status: string | null;
    }>();

  return assemblePage(results, pageSize, (row) => ({
    id: row.id,
    matterId: row.matter_id,
    role: row.role,
    capacity: row.capacity,
    matterTitle: row.matter_title,
    matterNumber: row.matter_number,
    matterStatus: row.matter_status,
    linkedAt: row.created_at,
  }));
}

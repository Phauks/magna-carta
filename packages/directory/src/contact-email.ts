import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryEmailId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { assertEntityExists, nodeTableForEntityId } from "./entity-kind.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import {
  demoteEntityPrimaryEmailsStatement,
  insertEmailStatement,
  softDeleteEmailStatement,
  updateEmailStatement,
} from "./statements.ts";

// Thrown when an address is empty or has no local@domain shape. Contact addresses are captured from
// real correspondence, so the check is deliberately permissive — exactly one '@' with a non-empty part
// on each side — rather than a full RFC 5322 grammar that would reject legitimate unusual addresses.
export class InvalidEmailAddressError extends Error {
  readonly code = "invalid-email-address";
  constructor(address: string) {
    super(
      `directory: not a usable email address: ${JSON.stringify(address)} (invalid-email-address)`,
    );
    this.name = "InvalidEmailAddressError";
  }
}

// Thrown when an email id names no live row (missing or already soft-deleted).
export class DirectoryEmailNotFoundError extends Error {
  readonly code = "directory-email-not-found";
  constructor(emailId: string) {
    super(`directory: email not found or soft-deleted: ${emailId} (directory-email-not-found)`);
    this.name = "DirectoryEmailNotFoundError";
  }
}

// The reverse-lookup match key. Case-insensitive on the whole address and whitespace-trimmed — the two
// normalizations everyone applies to email in practice. No provider-specific folding (Gmail dots/plus):
// that would merge addresses that route to different mailboxes at other providers, which for a
// conflicts/participant lookup is a false match, not a convenience.
export function normalizeEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}

// Validate and split an address into its stored form (trimmed, as entered) and its normalized key.
function prepareAddress(address: string): { stored: string; normalized: string } {
  const stored = address.trim();
  const atIndex = stored.indexOf("@");
  const lastAtIndex = stored.lastIndexOf("@");
  // Exactly one '@', with a non-empty local part and domain. length>0 also satisfies the table CHECK.
  if (
    stored.length === 0 ||
    atIndex <= 0 ||
    atIndex !== lastAtIndex ||
    atIndex === stored.length - 1
  ) {
    throw new InvalidEmailAddressError(address);
  }
  return { stored, normalized: normalizeEmailAddress(stored) };
}

export interface AddEmailInput {
  readonly entityId: string;
  readonly address: string;
  readonly label?: string | null;
  // Make this the entity's primary email; any existing primary is demoted in the same batch.
  readonly isPrimary?: boolean;
}

// Attach an email address to a directory entity within an atomic batch that also writes the domain
// audit row. Rejects a missing or soft-deleted entity, and a malformed address, before any write. When
// isPrimary is set, the entity's other live primaries are demoted first so at most one primary survives.
export async function addEmail(
  database: BatchDatabase,
  input: AddEmailInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryEmailId> {
  await assertEntityExists(database, input.entityId);
  const { stored, normalized } = prepareAddress(input.address);

  const emailId = newIdentifier("directoryEmail", options.randomSource);
  const now = options.clock.now();
  const isPrimary: 0 | 1 = input.isPrimary ? 1 : 0;

  const statements: SqlStatement[] = [];
  if (isPrimary === 1) {
    statements.push(demoteEntityPrimaryEmailsStatement(database, input.entityId, now));
  }
  statements.push(
    insertEmailStatement(database, {
      id: emailId,
      entityId: input.entityId,
      label: input.label ?? null,
      address: stored,
      normalizedAddress: normalized,
      isPrimary,
      createdAt: now,
    }),
    directoryAuditStatement(database, options, "directory.email.added", emailId),
  );

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: emailId },
    value: emailId,
    fromBody: (body) => (body as { id: DirectoryEmailId }).id,
  }));
}

interface EmailRow {
  readonly id: DirectoryEmailId;
  readonly entity_id: string;
  readonly label: string | null;
  readonly address: string;
  readonly is_primary: number;
  readonly deleted_at: string | null;
}

async function readLiveEmailRow(
  database: BatchDatabase,
  emailId: string,
): Promise<EmailRow | null> {
  const { results } = await database
    .prepare(
      `SELECT id, entity_id, label, address, is_primary, deleted_at FROM directory_email WHERE id = ?1`,
    )
    .bind(emailId)
    .all<EmailRow>();
  const row = results[0];
  if (row === undefined || row.deleted_at !== null) return null;
  return row;
}

export interface UpdateEmailInput {
  readonly emailId: string;
  // Each field is optional: an omitted field keeps its current value (a full-row UPDATE with the
  // current values re-bound, so the SQL column list never varies).
  readonly address?: string;
  readonly label?: string | null;
  readonly isPrimary?: boolean;
}

// Update a live email's fields within an atomic batch. Reads the current row first (D1 has no
// interactive transaction), so an omitted field is preserved rather than nulled. Setting isPrimary
// demotes the entity's other live primaries in the same batch.
export async function updateEmail(
  database: BatchDatabase,
  input: UpdateEmailInput,
  options: DirectoryWriteOptions,
): Promise<DirectoryEmailId> {
  const current = await readLiveEmailRow(database, input.emailId);
  if (current === null) throw new DirectoryEmailNotFoundError(input.emailId);

  const prepared =
    input.address === undefined
      ? { stored: current.address, normalized: normalizeEmailAddress(current.address) }
      : prepareAddress(input.address);
  const label = input.label === undefined ? current.label : input.label;
  const isPrimary: 0 | 1 =
    input.isPrimary === undefined ? (current.is_primary === 1 ? 1 : 0) : input.isPrimary ? 1 : 0;

  const now = options.clock.now();
  const emailId = current.id;
  const statements: SqlStatement[] = [];
  // Demote siblings only when this row is becoming primary and was not already the primary.
  if (isPrimary === 1 && current.is_primary !== 1) {
    statements.push(demoteEntityPrimaryEmailsStatement(database, current.entity_id, now));
  }
  statements.push(
    updateEmailStatement(
      database,
      emailId,
      { label, address: prepared.stored, normalizedAddress: prepared.normalized, isPrimary },
      now,
    ),
    directoryAuditStatement(database, options, "directory.email.updated", emailId),
  );

  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 200,
    responseBody: { id: emailId },
    value: emailId,
    fromBody: (body) => (body as { id: DirectoryEmailId }).id,
  }));
}

// Soft-delete an email row (never a hard delete). A missing or already-deleted id fails loudly.
export async function removeEmail(
  database: BatchDatabase,
  emailId: string,
  options: DirectoryWriteOptions,
): Promise<DirectoryEmailId> {
  const current = await readLiveEmailRow(database, emailId);
  if (current === null) throw new DirectoryEmailNotFoundError(emailId);

  const now = options.clock.now();
  const id = current.id;
  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      softDeleteEmailStatement(database, id, now),
      directoryAuditStatement(database, options, "directory.email.removed", id),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: { id },
    value: id,
    fromBody: (body) => (body as { id: DirectoryEmailId }).id,
  }));
}

export interface DirectoryEmailRow {
  readonly id: DirectoryEmailId;
  readonly entityId: string;
  readonly label: string | null;
  readonly address: string;
  readonly isPrimary: boolean;
}

// The live email rows on an entity, primary first, then oldest first for a stable read.
export async function readEmails(
  database: BatchDatabase,
  entityId: string,
): Promise<DirectoryEmailRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, entity_id, label, address, is_primary FROM directory_email WHERE entity_id = ?1 AND deleted_at IS NULL ORDER BY is_primary DESC, created_at ASC, id ASC`,
    )
    .bind(entityId)
    .all<{
      id: DirectoryEmailId;
      entity_id: string;
      label: string | null;
      address: string;
      is_primary: number;
    }>();
  return results.map((row) => ({
    id: row.id,
    entityId: row.entity_id,
    label: row.label,
    address: row.address,
    isPrimary: row.is_primary === 1,
  }));
}

// One resolved match from the reverse address -> entity lookup. entityId is already resolved to the
// surviving master when the owning entity was merged away, so a caller links to the live entity, never
// a subordinate. address/emailId carry the matched row for provenance.
export interface DirectoryEmailMatch {
  readonly entityId: string;
  readonly emailId: DirectoryEmailId;
  readonly address: string;
  readonly isPrimary: boolean;
}

// Resolve an email address to the directory entities that own it — the capability email filing needs to
// link a captured message's participants to Directory Person/Organization records. Matches are
// case-insensitive (the normalized key), exclude soft-deleted email rows, and resolve a merged-away
// owner to its surviving master (mirroring the name search channels), dropping any whose resolved entity
// is itself soft-deleted. One entry per resolved entity; when several rows resolve to the same entity a
// primary match wins the isPrimary flag. An unknown or malformed address yields an empty list, never a
// throw — a lookup is a read, not a validated write.
export async function findEntitiesByEmailAddress(
  database: BatchDatabase,
  address: string,
): Promise<DirectoryEmailMatch[]> {
  const normalized = normalizeEmailAddress(address);
  if (normalized.length === 0) return [];

  const { results } = await database
    .prepare(
      `SELECT id, entity_id, address, is_primary FROM directory_email WHERE normalized_address = ?1 AND deleted_at IS NULL`,
    )
    .bind(normalized)
    .all<{ id: DirectoryEmailId; entity_id: string; address: string; is_primary: number }>();

  const byEntity = new Map<string, DirectoryEmailMatch>();
  for (const row of results) {
    const resolvedEntityId = await resolveLiveEntity(database, row.entity_id);
    if (resolvedEntityId === null) continue; // owner (or its master) is soft-deleted — drop it
    const isPrimary = row.is_primary === 1;
    const existing = byEntity.get(resolvedEntityId);
    if (existing === undefined) {
      byEntity.set(resolvedEntityId, {
        entityId: resolvedEntityId,
        emailId: row.id,
        address: row.address,
        isPrimary,
      });
    } else if (isPrimary && !existing.isPrimary) {
      byEntity.set(resolvedEntityId, {
        ...existing,
        emailId: row.id,
        address: row.address,
        isPrimary,
      });
    }
  }
  return [...byEntity.values()];
}

// The most addresses one batched lookup will resolve. The address set comes from a captured message's
// from/to/cc/bcc, which is bounded by the message and not by anything this platform chose — a message
// with two hundred recipients is a legitimate input, and an unbounded IN list is not.
export const MAXIMUM_BATCHED_EMAIL_LOOKUPS = 100;

/**
 * Resolve MANY email addresses to their directory entities in one query, keyed by the normalized
 * address each caller passed.
 *
 * The batched twin of `findEntitiesByEmailAddress`, and the shape the email-capture path needs: that
 * path resolves every participant on a message, and doing it one address at a time is one serial round
 * trip per recipient inside a queue consumer — the N+1 the read paths in this codebase are careful to
 * avoid. The email-address index is already the thing being seeked; this asks it once.
 *
 * Same semantics as the single-address form in every other respect: case-insensitive on the normalized
 * key, soft-deleted email rows excluded, a merged-away owner resolved to its surviving master, and one
 * entry per resolved entity with a primary match winning the flag. Addresses with no match are simply
 * absent from the returned map rather than present with an empty list, so a caller reads "resolved" as
 * membership.
 */
export async function findEntitiesByEmailAddresses(
  database: BatchDatabase,
  addresses: readonly string[],
): Promise<Map<string, DirectoryEmailMatch[]>> {
  const normalizedByOriginal = new Map<string, string>();
  const distinct: string[] = [];
  for (const address of addresses) {
    const normalized = normalizeEmailAddress(address);
    if (normalized.length === 0) continue;
    normalizedByOriginal.set(address, normalized);
    if (!distinct.includes(normalized)) distinct.push(normalized);
    if (distinct.length >= MAXIMUM_BATCHED_EMAIL_LOOKUPS) break;
  }
  if (distinct.length === 0) return new Map();

  const placeholders = distinct.map((_unused, index) => `?${index + 1}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT id, entity_id, address, normalized_address, is_primary FROM directory_email ` +
        `WHERE normalized_address IN (${placeholders}) AND deleted_at IS NULL`,
    )
    .bind(...distinct)
    .all<{
      id: DirectoryEmailId;
      entity_id: string;
      address: string;
      normalized_address: string;
      is_primary: number;
    }>();

  // The merge/soft-delete resolution is memoized across the whole batch: a firm's messages routinely
  // carry several addresses belonging to one entity, and each would otherwise re-ask the same question.
  const resolvedEntityCache = new Map<string, string | null>();
  const byNormalized = new Map<string, Map<string, DirectoryEmailMatch>>();
  for (const row of results) {
    let resolvedEntityId = resolvedEntityCache.get(row.entity_id);
    if (resolvedEntityId === undefined) {
      resolvedEntityId = await resolveLiveEntity(database, row.entity_id);
      resolvedEntityCache.set(row.entity_id, resolvedEntityId);
    }
    if (resolvedEntityId === null) continue; // owner (or its master) is soft-deleted — drop it
    const isPrimary = row.is_primary === 1;
    let byEntity = byNormalized.get(row.normalized_address);
    if (byEntity === undefined) {
      byEntity = new Map<string, DirectoryEmailMatch>();
      byNormalized.set(row.normalized_address, byEntity);
    }
    const existing = byEntity.get(resolvedEntityId);
    if (existing === undefined || (isPrimary && !existing.isPrimary)) {
      byEntity.set(resolvedEntityId, {
        entityId: resolvedEntityId,
        emailId: row.id,
        address: row.address,
        isPrimary,
      });
    }
  }

  // Keyed back by the address the CALLER passed, so a caller need not re-normalize to read the answer.
  const matchesByAddress = new Map<string, DirectoryEmailMatch[]>();
  for (const [original, normalized] of normalizedByOriginal) {
    const byEntity = byNormalized.get(normalized);
    if (byEntity !== undefined && byEntity.size > 0) {
      matchesByAddress.set(original, [...byEntity.values()]);
    }
  }
  return matchesByAddress;
}

// Resolve an entity id to the live entity it stands for: follow merged_into_id to the master, and
// return null when the entity (or its master) is soft-deleted or missing. The in-code twin of the
// name channels' COALESCE(merged_into_id, id) + deleted_at predicate.
async function resolveLiveEntity(
  database: BatchDatabase,
  entityId: string,
): Promise<string | null> {
  const table = nodeTableForEntityId(entityId);
  const { results } = await database
    .prepare(`SELECT merged_into_id, deleted_at FROM ${table} WHERE id = ?1`)
    .bind(entityId)
    .all<{ merged_into_id: string | null; deleted_at: string | null }>();
  const row = results[0];
  if (row === undefined) return null;
  if (row.merged_into_id !== null) {
    const masterId = row.merged_into_id;
    const masterTable = nodeTableForEntityId(masterId);
    const { results: masterResults } = await database
      .prepare(`SELECT deleted_at FROM ${masterTable} WHERE id = ?1`)
      .bind(masterId)
      .all<{ deleted_at: string | null }>();
    const masterRow = masterResults[0];
    return masterRow !== undefined && masterRow.deleted_at === null ? masterId : null;
  }
  return row.deleted_at === null ? entityId : null;
}

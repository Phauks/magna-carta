import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DirectoryReferralSourceId } from "@magna-carta/identifiers/types";
import { directoryAuditStatement, type DirectoryWriteOptions } from "./audit.ts";
import { readEntityDisplayNames } from "./entity-display.ts";
import { assertEntityExists } from "./entity-kind.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";

// HOW A CLIENT FOUND THE FIRM.
//
// Two facts, either or both: a SOURCE from the firm's own list (Past Client, Another Attorney,
// Website), and the person or organization in the directory who REFERRED them. A client who found
// the firm through a search engine has a source and no person; a client sent by a colleague whose
// category nobody wrote down has a person and no source. Neither is required, and a client with
// neither holds no row at all.
//
// The list is the firm's: it is seeded with a starting set, and the firm renames, reorders, retires
// and adds to it. A source is retired rather than deleted, because clients already recorded under it
// keep saying so; a retired source is refused as a NEW choice and kept as a standing one.
//
// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const DIRECTORY_REFERRAL_SOURCE_TABLE = "directory_referral_source";
export const DIRECTORY_ENTITY_REFERRAL_TABLE = "directory_entity_referral";

/** One source on the firm's list. */
export interface ReferralSourceRow {
  readonly id: DirectoryReferralSourceId;
  readonly name: string;
  readonly position: number;
  /** True for a source the firm has retired: still shown where it is recorded, never offered. */
  readonly archived: boolean;
}

/** The person or organization who referred a client, as a list row would name them. */
export interface ReferrerSummary {
  readonly entityId: string;
  /** Null when the directory holds no name for the record; the caller shows the gap. */
  readonly displayName: string | null;
  /** The surviving record this one was folded into, or null while it stands on its own. */
  readonly mergedIntoId: string | null;
}

/** One client's referral: a source, a referrer, or both. */
export interface EntityReferral {
  readonly entityId: string;
  readonly source: {
    readonly id: DirectoryReferralSourceId;
    readonly name: string;
    readonly archived: boolean;
  } | null;
  readonly referrer: ReferrerSummary | null;
}

/** Thrown when a write names a source the firm's list does not hold. */
export class ReferralSourceNotFoundError extends Error {
  readonly code = "not-found";
  constructor(sourceId: string) {
    super(`directory: referral source not found: ${sourceId}`);
    this.name = "ReferralSourceNotFoundError";
  }
}

/** Thrown when a referral newly names a source the firm has retired. */
export class ReferralSourceRetiredError extends Error {
  readonly code = "referral-source-retired";
  constructor(sourceId: string) {
    super(`directory: referral source ${sourceId} is retired and cannot be chosen`);
    this.name = "ReferralSourceRetiredError";
  }
}

/** Thrown when a record is named as its own referrer. */
export class SelfReferralError extends Error {
  readonly code = "self-referral";
  constructor(entityId: string) {
    super(`directory: ${entityId} cannot be recorded as its own referrer`);
    this.name = "SelfReferralError";
  }
}

/** Thrown when a source is given a name that is empty once trimmed. */
export class ReferralSourceNameError extends Error {
  readonly code = "referral-source-name-empty";
  constructor() {
    super("directory: a referral source needs a name");
    this.name = "ReferralSourceNameError";
  }
}

interface RawSourceRow {
  id: string;
  name: string;
  position: number;
  archived: number;
}

function sourceRowOf(row: RawSourceRow): ReferralSourceRow {
  return {
    id: row.id as DirectoryReferralSourceId,
    name: row.name,
    position: row.position,
    archived: row.archived === 1,
  };
}

/**
 * The firm's whole list, in display order. Retired sources are INCLUDED and flagged: a client
 * recorded under one still shows it, so the picker that hides them and the record that shows one
 * read the same list.
 */
export async function listReferralSources(database: SqlDatabase): Promise<ReferralSourceRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, name, position, archived FROM directory_referral_source
        ORDER BY position ASC, id ASC`,
    )
    .all<RawSourceRow>();
  return results.map(sourceRowOf);
}

async function readReferralSource(
  database: SqlDatabase,
  sourceId: string,
): Promise<ReferralSourceRow | undefined> {
  const { results } = await database
    .prepare(`SELECT id, name, position, archived FROM directory_referral_source WHERE id = ?1`)
    .bind(sourceId)
    .all<RawSourceRow>();
  const row = results[0];
  return row === undefined ? undefined : sourceRowOf(row);
}

function trimmedName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new ReferralSourceNameError();
  return trimmed;
}

/** What a new source needs: its name. It joins the end of the list. */
export interface CreateReferralSourceInput {
  readonly name: string;
}

/** Adds a source to the end of the firm's list. */
export async function createReferralSource(
  database: BatchDatabase,
  input: CreateReferralSourceInput,
  options: DirectoryWriteOptions,
): Promise<ReferralSourceRow> {
  const name = trimmedName(input.name);
  const existing = await listReferralSources(database);
  const position = existing.reduce((highest, row) => Math.max(highest, row.position + 1), 0);
  const id = newIdentifier("directoryReferralSource", options.randomSource);
  const now = options.clock.now();
  const row: ReferralSourceRow = { id, name, position, archived: false };
  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      database
        .prepare(
          `INSERT INTO directory_referral_source (id, name, position, archived, created_at, updated_at)
           VALUES (?1, ?2, ?3, 0, ?4, ?4)`,
        )
        .bind(id, name, position, now),
      directoryAuditStatement(database, options, "directory.referralSource.created", id),
    ],
    outboxMessages: [],
    responseCode: 201,
    responseBody: row,
    value: row,
    fromBody: (body) => body as ReferralSourceRow,
  }));
}

/**
 * What may change about a source. Every field is optional; an absent field is left as it is.
 * `position` is the place in the list the source should take, counted from zero, and the rest of
 * the list closes up around it, so a reorder is one write rather than a swap of two.
 */
export interface UpdateReferralSourceInput {
  readonly name?: string;
  readonly position?: number;
  readonly archived?: boolean;
}

/** Renames, moves, retires or restores a source, and answers the source as it now stands. */
export async function updateReferralSource(
  database: BatchDatabase,
  sourceId: string,
  input: UpdateReferralSourceInput,
  options: DirectoryWriteOptions,
): Promise<ReferralSourceRow> {
  const list = await listReferralSources(database);
  const current = list.find((row) => row.id === sourceId);
  if (current === undefined) throw new ReferralSourceNotFoundError(sourceId);
  const name = input.name === undefined ? current.name : trimmedName(input.name);
  const archived = input.archived ?? current.archived;
  const now = options.clock.now();

  const statements: SqlStatement[] = [
    database
      .prepare(
        `UPDATE directory_referral_source SET name = ?2, archived = ?3, updated_at = ?4 WHERE id = ?1`,
      )
      .bind(sourceId, name, archived ? 1 : 0, now),
  ];

  let position = current.position;
  if (input.position !== undefined) {
    // Take the source out, put it back at the asked-for place, and number the whole list again
    // from zero. The list is a firm's handful of sources, so rewriting each position is cheap and
    // leaves no gaps or ties for a later move to trip on.
    const others = list.filter((row) => row.id !== sourceId);
    const place = Math.max(0, Math.min(Math.trunc(input.position), others.length));
    const ordered = [...others.slice(0, place), current, ...others.slice(place)];
    ordered.forEach((row, index) => {
      if (row.id === sourceId) position = index;
      if (row.position === index && row.id !== sourceId) return;
      statements.push(
        database
          .prepare(
            `UPDATE directory_referral_source SET position = ?2, updated_at = ?3 WHERE id = ?1`,
          )
          .bind(row.id, index, now),
      );
    });
  }

  const event =
    archived !== current.archived
      ? archived
        ? "directory.referralSource.retired"
        : "directory.referralSource.restored"
      : "directory.referralSource.changed";
  statements.push(directoryAuditStatement(database, options, event, sourceId));

  const row: ReferralSourceRow = { id: current.id, name, position, archived };
  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 200,
    responseBody: row,
    value: row,
    fromBody: (body) => body as ReferralSourceRow,
  }));
}

interface RawReferralRow {
  entity_id: string;
  source_id: string | null;
  referrer_entity_id: string | null;
  source_name: string | null;
  source_archived: number | null;
}

/** How many records one read of the referral table names; each is a bound parameter. */
const REFERRAL_READ_CHUNK = 100;

/**
 * The referrals of many records, in one read per hundred records and one display-name read for all
 * their referrers. A record with no referral is absent from the answer. The read a report uses: a
 * page of clients is resolved here at once, never one client per query.
 */
export async function readEntityReferrals(
  database: SqlDatabase,
  entityIds: readonly string[],
): Promise<EntityReferral[]> {
  const unique = [...new Set(entityIds)];
  const rows: RawReferralRow[] = [];
  for (let start = 0; start < unique.length; start += REFERRAL_READ_CHUNK) {
    const chunk = unique.slice(start, start + REFERRAL_READ_CHUNK);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT r.entity_id, r.source_id, r.referrer_entity_id,
                s.name AS source_name, s.archived AS source_archived
           FROM directory_entity_referral r
           LEFT JOIN directory_referral_source s ON s.id = r.source_id
          WHERE r.entity_id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<RawReferralRow>();
    rows.push(...results);
  }

  const referrerIds = rows.flatMap((row) =>
    row.referrer_entity_id === null ? [] : [row.referrer_entity_id],
  );
  const names = new Map<string, ReferrerSummary>();
  const uniqueReferrers = [...new Set(referrerIds)];
  for (let start = 0; start < uniqueReferrers.length; start += REFERRAL_READ_CHUNK) {
    for (const entry of await readEntityDisplayNames(
      database,
      uniqueReferrers.slice(start, start + REFERRAL_READ_CHUNK),
    )) {
      names.set(entry.entityId, {
        entityId: entry.entityId,
        displayName: entry.displayName,
        mergedIntoId: entry.mergedIntoId,
      });
    }
  }

  return rows.map((row) => ({
    entityId: row.entity_id,
    source:
      row.source_id === null
        ? null
        : {
            id: row.source_id as DirectoryReferralSourceId,
            name: row.source_name ?? "",
            archived: row.source_archived === 1,
          },
    referrer:
      row.referrer_entity_id === null
        ? null
        : (names.get(row.referrer_entity_id) ?? {
            // A referrer whose record is gone is still named by handle on the row; the caller shows
            // the gap rather than a name.
            entityId: row.referrer_entity_id,
            displayName: null,
            mergedIntoId: null,
          }),
  }));
}

/** One record's referral, or null where it holds none. */
export async function readEntityReferral(
  database: SqlDatabase,
  entityId: string,
): Promise<EntityReferral | null> {
  const [referral] = await readEntityReferrals(database, [entityId]);
  return referral ?? null;
}

/** What a referral write states. Both null removes the record's referral. */
export interface SetEntityReferralInput {
  readonly sourceId: string | null;
  readonly referrerEntityId: string | null;
}

/**
 * Records a record's referral, replacing what it held, and answers it as it now reads. Both fields
 * null removes the row, because a referral that says nothing is no referral. The record and the
 * referrer must exist and stand on their own; a record is never its own referrer; and a source the
 * firm has retired may be KEPT but not newly chosen.
 */
export async function setEntityReferral(
  database: BatchDatabase,
  entityId: string,
  input: SetEntityReferralInput,
  options: DirectoryWriteOptions,
): Promise<EntityReferral | null> {
  await assertEntityExists(database, entityId);
  const existing = await readEntityReferral(database, entityId);

  if (input.sourceId === null && input.referrerEntityId === null) {
    if (existing === null) return null;
    await runDirectoryEffect(database, options.idempotency, options.clock, () => ({
      statements: [
        database
          .prepare(`DELETE FROM directory_entity_referral WHERE entity_id = ?1`)
          .bind(entityId),
        directoryAuditStatement(database, options, "directory.referral.removed", entityId),
      ],
      outboxMessages: [],
      responseCode: 200,
      responseBody: { referral: null },
      value: null,
      fromBody: () => null,
    }));
    return null;
  }

  let source: EntityReferral["source"] = null;
  if (input.sourceId !== null) {
    const row = await readReferralSource(database, input.sourceId);
    if (row === undefined) throw new ReferralSourceNotFoundError(input.sourceId);
    if (row.archived && existing?.source?.id !== row.id) {
      throw new ReferralSourceRetiredError(row.id);
    }
    source = { id: row.id, name: row.name, archived: row.archived };
  }

  let referrer: ReferrerSummary | null = null;
  if (input.referrerEntityId !== null) {
    if (input.referrerEntityId === entityId) throw new SelfReferralError(entityId);
    await assertEntityExists(database, input.referrerEntityId);
    const [named] = await readEntityDisplayNames(database, [input.referrerEntityId]);
    referrer = {
      entityId: input.referrerEntityId,
      displayName: named?.displayName ?? null,
      mergedIntoId: named?.mergedIntoId ?? null,
    };
  }

  const now = options.clock.now();
  const referral: EntityReferral = { entityId, source, referrer };
  return runDirectoryEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      database
        .prepare(
          `INSERT INTO directory_entity_referral (entity_id, source_id, referrer_entity_id, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?4)
           ON CONFLICT(entity_id) DO UPDATE SET
             source_id = excluded.source_id,
             referrer_entity_id = excluded.referrer_entity_id,
             updated_at = excluded.updated_at`,
        )
        .bind(entityId, input.sourceId, input.referrerEntityId, now),
      directoryAuditStatement(database, options, "directory.referral.recorded", entityId),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: { referral },
    value: referral,
    fromBody: (body) => (body as { referral: EntityReferral | null }).referral,
  }));
}

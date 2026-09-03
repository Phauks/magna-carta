import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  ConflictsDispositionId,
  ConflictsHitId,
  UserId,
} from "@magna-carta/identifiers/types";
import { conflictsAuditStatement, type ConflictsWriteOptions } from "./audit.ts";
import { runConflictsEffect } from "./run-conflicts-effect.ts";
import {
  CONFLICTS_DISPOSITION_TABLE,
  CONFLICTS_HIT_TABLE,
  insertDispositionStatement,
} from "./statements.ts";
import type { DispositionKind, EvidenceTier } from "./types.ts";
import { isCivilDate, type StoredWaiver, type WaiverInput } from "./waiver.ts";

// A reviewer's adjudication of one conflicts_hit row. Every call appends a new conflicts_disposition
// row — the table is append-only (see the migration's RAISE(ABORT) triggers) — so a reviewer who
// clears a hit and later reverses that call leaves BOTH rows on the books. The reversal is not an
// edit; it is a second act, and the audit trail is the point.
//
// wall_erected records that an ethical wall was put in place as an OUTCOME of adjudication — it
// enforces nothing by itself. No access restriction follows from writing this row; that enforcement,
// if and when it is built, is a separate mechanism entirely.
//
// waiver_obtained is the one kind that carries a record of its own, because it is the one kind that
// names a thing outside this system which the firm will be asked to produce. See waiver.ts.
export interface RecordDispositionInput {
  readonly hitId: string;
  readonly kind: DispositionKind;
  readonly rationale: string;
  readonly reviewerUserId: UserId;
  /**
   * The waiver's own record. Required on `waiver_obtained` and refused on every other kind.
   *
   * WHAT IS REQUIRED AND WHAT IS ALLOWED TO BE MISSING, and why the line falls where it does. Who
   * consented and when they consented are constitutive of the act: a reviewer who cannot say either
   * is not recording a waiver, they are recording an impression, so the write is refused. The
   * WRITTEN CONFIRMATION is different — it is evidence that follows the act, it genuinely arrives
   * afterwards, and refusing the row until it exists would only push the reviewer into recording
   * some other kind, leaving the firm's log with no waiver on it at all. So an unconfirmed waiver is
   * recorded and reads as incomplete everywhere it is shown (waiverShortfalls), which is the one
   * outcome that neither loses the fact nor flatters it.
   */
  readonly waiver?: WaiverInput;
}

export class EmptyRationaleError extends Error {
  readonly code = "empty-rationale";
  constructor() {
    super("empty-rationale: a disposition rationale must not be blank");
    this.name = "EmptyRationaleError";
  }
}

export class UnknownHitError extends Error {
  readonly code = "unknown-hit";
  constructor(hitId: string) {
    super(`unknown-hit: no conflicts_hit row exists for id ${hitId}`);
    this.name = "UnknownHitError";
  }
}

// The constitutive half of the waiver record. Not a completeness check: the written confirmation and
// the filed document are deliberately allowed to be missing, and are reported as a shortfall instead.
export class WaiverRecordRequiredError extends Error {
  readonly code = "waiver-record-required";
  constructor(missing: string) {
    super(
      `waiver-record-required: a waiver_obtained disposition must record ${missing} — who consented and when they consented are the act itself`,
    );
    this.name = "WaiverRecordRequiredError";
  }
}

export class WaiverRecordNotApplicableError extends Error {
  readonly code = "waiver-record-not-applicable";
  constructor(kind: DispositionKind) {
    super(
      `waiver-record-not-applicable: a ${kind} disposition carries no waiver record; only waiver_obtained does`,
    );
    this.name = "WaiverRecordNotApplicableError";
  }
}

export class InvalidWaiverDateError extends Error {
  readonly code = "invalid-waiver-date";
  constructor(givenOn: string) {
    super(
      `invalid-waiver-date: the date a waiver was given must be a civil date in YYYY-MM-DD form, not ${givenOn}`,
    );
    this.name = "InvalidWaiverDateError";
  }
}

export class UnknownConsentingPartyError extends Error {
  readonly code = "unknown-consenting-party";
  constructor(entityId: string) {
    super(
      `unknown-consenting-party: no Directory person or organization exists for id ${entityId}`,
    );
    this.name = "UnknownConsentingPartyError";
  }
}

export class UnknownWaiverDocumentError extends Error {
  readonly code = "unknown-waiver-document";
  constructor(fileId: string) {
    super(`unknown-waiver-document: no live file exists for id ${fileId}`);
    this.name = "UnknownWaiverDocumentError";
  }
}

export interface DispositionRow {
  readonly id: string;
  readonly hitId: string;
  readonly kind: DispositionKind;
  readonly rationale: string;
  readonly reviewerUserId: string;
  /**
   * The waiver's own record as the row holds it. Null on every kind but `waiver_obtained`, and on a
   * waiver row written before the columns existed — which is the row not saying, and is reported as
   * a shortfall exactly like an absent field on a row that has them.
   */
  readonly waiver: StoredWaiver | null;
  readonly createdAt: string;
}

async function hitExists(database: SqlDatabase, hitId: string): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT id FROM ${CONFLICTS_HIT_TABLE} WHERE id = ?1`)
    .bind(hitId)
    .all<{ id: string }>();
  return results.length > 0;
}

// Whether the consenting party is a live Directory entity. An entity is a person OR an organization,
// so this asks both node tables rather than following a foreign key the schema cannot express. The
// check exists because the whole point of naming the giver by handle is that a reader can look them
// up: a handle nothing resolves is the typed-in name again, wearing a prefix.
async function directoryEntityExists(database: SqlDatabase, entityId: string): Promise<boolean> {
  const table = entityId.startsWith("directoryPerson_")
    ? "directory_person"
    : entityId.startsWith("directoryOrganization_")
      ? "directory_organization"
      : null;
  if (table === null) return false;
  const { results } = await database
    .prepare(`SELECT id FROM ${table} WHERE id = ?1`)
    .bind(entityId)
    .all<{ id: string }>();
  return results.length > 0;
}

// Whether the evidencing document is a live file. A deleted file is refused here rather than at read
// time: a waiver pointing at a document that was already gone when it was recorded would produce, on
// the day it is asked for, a reference and no confirmation.
async function fileExists(database: SqlDatabase, fileId: string): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT id FROM file WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(fileId)
    .all<{ id: string }>();
  return results.length > 0;
}

// Everything the waiver record must satisfy before a statement is prepared, in one place. Returns
// the row shape to store; throws the specific refusal otherwise.
async function resolveWaiverForWrite(
  database: SqlDatabase,
  input: RecordDispositionInput,
): Promise<StoredWaiver | null> {
  if (input.kind !== "waiver_obtained") {
    if (input.waiver !== undefined) throw new WaiverRecordNotApplicableError(input.kind);
    return null;
  }
  const waiver = input.waiver;
  if (waiver === undefined) {
    throw new WaiverRecordRequiredError("the consenting party and the date it was given");
  }
  if (waiver.givenByEntityId.trim() === "") {
    throw new WaiverRecordRequiredError("the consenting party");
  }
  if (waiver.givenOn.trim() === "") {
    throw new WaiverRecordRequiredError("the date it was given");
  }
  if (!isCivilDate(waiver.givenOn)) throw new InvalidWaiverDateError(waiver.givenOn);
  if (!(await directoryEntityExists(database, waiver.givenByEntityId))) {
    throw new UnknownConsentingPartyError(waiver.givenByEntityId);
  }
  if (waiver.documentFileId !== null && !(await fileExists(database, waiver.documentFileId))) {
    throw new UnknownWaiverDocumentError(waiver.documentFileId);
  }
  return {
    givenByEntityId: waiver.givenByEntityId,
    confirmedInWriting: waiver.confirmedInWriting,
    documentFileId: waiver.documentFileId,
    givenOn: waiver.givenOn,
  };
}

// The four waiver columns as one value, or null when the row carries none of them. A row that holds
// nothing is null rather than an object of four nulls, so "this is not a waiver" and "this waiver
// says nothing" are not spelled the same way by every reader downstream.
function waiverFromRow(row: {
  waiver_given_by_entity_id: string | null;
  waiver_confirmed_in_writing: number | null;
  waiver_document_file_id: string | null;
  waiver_given_on: string | null;
}): StoredWaiver | null {
  if (
    row.waiver_given_by_entity_id === null &&
    row.waiver_confirmed_in_writing === null &&
    row.waiver_document_file_id === null &&
    row.waiver_given_on === null
  ) {
    return null;
  }
  return {
    givenByEntityId: row.waiver_given_by_entity_id,
    confirmedInWriting:
      row.waiver_confirmed_in_writing === null ? null : row.waiver_confirmed_in_writing === 1,
    documentFileId: row.waiver_document_file_id,
    givenOn: row.waiver_given_on,
  };
}

export async function recordDisposition(
  database: BatchDatabase,
  input: RecordDispositionInput,
  options: ConflictsWriteOptions,
): Promise<ConflictsDispositionId> {
  // Read and validate everything before composing the batch: D1 has no interactive transactions, so
  // an invalid disposition must be rejected before any statement is ever prepared, never rolled back
  // after the fact.
  if (input.rationale.trim().length === 0) {
    throw new EmptyRationaleError();
  }
  if (!(await hitExists(database, input.hitId))) {
    throw new UnknownHitError(input.hitId);
  }
  const waiver = await resolveWaiverForWrite(database, input);

  const dispositionId = newIdentifier("conflictsDisposition", options.randomSource);
  const now = options.clock.now();

  return runConflictsEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      insertDispositionStatement(database, {
        id: dispositionId,
        hitId: input.hitId as ConflictsHitId,
        kind: input.kind,
        rationale: input.rationale,
        reviewerUserId: input.reviewerUserId,
        waiver,
        createdAt: now,
      }),
      conflictsAuditStatement(database, options, "conflicts.disposition.recorded", dispositionId),
    ],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: dispositionId },
    value: dispositionId,
    fromBody: (body) => (body as { id: ConflictsDispositionId }).id,
  }));
}

// The rows are never updated, so the latest row by created_at IS the current disposition; every
// earlier row remains in the table as the audit trail of how adjudication got here. The tie-break is
// `rowid` (insertion-monotonic), NOT `id`: identifiers are random 21-char tokens with no time order, so
// two dispositions written on one hit inside the same millisecond (a reviewer reversing a call, or two
// reviewers racing) would otherwise resolve to a lexically-random winner — surfacing a reversed conflict
// as still cleared. `rowid` increases with each append, so it always returns the genuinely-latest row.
// One hit of a check, with the reviewer's latest word on it — or nothing, when no reviewer has acted.
export interface HitDispositionState {
  readonly hitId: string;
  readonly evidenceTier: EvidenceTier;
  readonly sourceClass: string;
  readonly coParty: boolean;
  readonly disposition: DispositionRow | null;
}

// Every hit of one check with its current disposition, in ONE query.
//
// The obvious shape — read the hits, then call readCurrentDisposition per hit — is the N+1 the
// posture read cannot afford: a check against a wide corpus surfaces hundreds of hits, and the read
// runs on every page view of a matter. The correlated subquery picks the same row readCurrentDisposition
// would pick, by the same `created_at DESC, rowid DESC` tie-break and for the same reason: identifiers
// are random tokens with no time order, so two dispositions written on one hit inside the same
// millisecond would otherwise resolve to a lexically-random winner, and the losing row might be the
// reversal. `rowid` increases with each append, so it always names the genuinely-latest row. Both the
// filter and the ordering are served by the (hit_id, created_at) index.
export async function readHitDispositionStates(
  database: SqlDatabase,
  checkId: string,
): Promise<HitDispositionState[]> {
  const { results } = await database
    .prepare(
      `SELECT hit.id AS hit_id, hit.evidence_tier, hit.source_class, hit.co_party,
              latest.id AS disposition_id, latest.kind, latest.rationale, latest.reviewer_user_id,
              latest.waiver_given_by_entity_id, latest.waiver_confirmed_in_writing,
              latest.waiver_document_file_id, latest.waiver_given_on,
              latest.created_at AS disposition_created_at
         FROM ${CONFLICTS_HIT_TABLE} AS hit
         LEFT JOIN ${CONFLICTS_DISPOSITION_TABLE} AS latest
           ON latest.rowid = (
             SELECT candidate.rowid FROM ${CONFLICTS_DISPOSITION_TABLE} AS candidate
              WHERE candidate.hit_id = hit.id
              ORDER BY candidate.created_at DESC, candidate.rowid DESC
              LIMIT 1
           )
        WHERE hit.check_id = ?1
        ORDER BY hit.created_at ASC, hit.id ASC`,
    )
    .bind(checkId)
    .all<{
      hit_id: string;
      evidence_tier: number;
      source_class: string;
      co_party: number;
      disposition_id: string | null;
      kind: string | null;
      rationale: string | null;
      reviewer_user_id: string | null;
      waiver_given_by_entity_id: string | null;
      waiver_confirmed_in_writing: number | null;
      waiver_document_file_id: string | null;
      waiver_given_on: string | null;
      disposition_created_at: string | null;
    }>();

  return results.map((row) => ({
    hitId: row.hit_id,
    evidenceTier: row.evidence_tier as EvidenceTier,
    sourceClass: row.source_class,
    coParty: row.co_party === 1,
    disposition:
      row.disposition_id === null ||
      row.kind === null ||
      row.rationale === null ||
      row.reviewer_user_id === null ||
      row.disposition_created_at === null
        ? null
        : {
            id: row.disposition_id,
            hitId: row.hit_id,
            kind: row.kind as DispositionKind,
            rationale: row.rationale,
            reviewerUserId: row.reviewer_user_id,
            waiver: waiverFromRow(row),
            createdAt: row.disposition_created_at,
          },
  }));
}

/*
 * EVERY answer recorded against one hit, oldest first — the adjudication trail.
 *
 * This is the compliance artifact the append-only rule exists for. A reviewer who clears a hit and
 * later reverses leaves both acts standing, because a reversal is a second row rather than an edit;
 * a read that returned only the latest word would hide exactly the history the table refuses to
 * destroy, and the firm would be unable to produce the sequence when somebody asks how a decision
 * was reached.
 *
 * OLDEST FIRST, which is the opposite of readCurrentDisposition's ordering and deliberately so: this
 * is read as a narrative from the first answer forward, where that one is picking a winner. The
 * `rowid` tie-break is kept for the same reason it exists there — identifiers are random tokens with
 * no time order, so two rows written inside the same millisecond would otherwise order at random,
 * and the pair that most needs a stable order is an answer and its reversal.
 *
 * Read one hit at a time, when a reviewer opens it. The check response deliberately does not carry
 * every disposition of every hit: that is the one thing only this view uses, and putting it on the
 * list read would grow every page view by it.
 */
export async function readDispositionTrail(
  database: SqlDatabase,
  hitId: string,
): Promise<DispositionRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, hit_id, kind, rationale, reviewer_user_id, waiver_given_by_entity_id, waiver_confirmed_in_writing, waiver_document_file_id, waiver_given_on, created_at FROM ${CONFLICTS_DISPOSITION_TABLE} WHERE hit_id = ?1 ORDER BY created_at ASC, rowid ASC`,
    )
    .bind(hitId)
    .all<{
      id: string;
      hit_id: string;
      kind: string;
      rationale: string;
      reviewer_user_id: string;
      waiver_given_by_entity_id: string | null;
      waiver_confirmed_in_writing: number | null;
      waiver_document_file_id: string | null;
      waiver_given_on: string | null;
      created_at: string;
    }>();
  return results.map((row) => ({
    id: row.id,
    hitId: row.hit_id,
    kind: row.kind as DispositionKind,
    rationale: row.rationale,
    reviewerUserId: row.reviewer_user_id,
    waiver: waiverFromRow(row),
    createdAt: row.created_at,
  }));
}

// D1 caps bound parameters at 100 per query, as everywhere else in this package.
const MAX_PRIOR_CONCLUSION_PARAMETERS = 100;

/** An answer an EARLIER check already recorded about the same party. Context, never a conclusion. */
export interface PriorConclusion {
  readonly entityId: string;
  /** The check that surfaced the earlier hit, so a reader can open it and judge for themselves. */
  readonly checkId: string;
  readonly kind: DispositionKind;
  readonly reviewerUserId: string;
  readonly createdAt: string;
}

/*
 * What the firm has already said about these parties, on some EARLIER check.
 *
 * MATCHED ON THE ENTITY ALONE, AND SHOWN AS CONTEXT — the owner's ruling of 2026-09-02, and the
 * whole design of this read follows from it. The tempting alternative is to decide that a re-surfaced
 * hit IS the hit already answered and mark it concluded. The case that settles it: a company cleared
 * in March under Rule 1.9 as a FORMER client re-surfaces in September through the graph, as the
 * subsidiary of a CURRENT client — a Rule 1.7 question on a higher bar. Same entity, different
 * question. Matching on the entity and presenting the March clearance as this hit's answer would
 * carry a judgment across two conflicts that are not the same conflict.
 *
 * So this returns what was said and by whom and on which check, and nothing here or above may turn
 * that into a disposition, a default, or a suppression. The reviewer still answers the hit.
 *
 * Narrower keys were considered and rejected for the same reason rather than a different one: adding
 * the source class would have made the September hit invisible precisely because it arrived through
 * the graph, and adding the evidence tier would make a firm turning on the over-inclusive band look
 * like a new conflict. Neither narrowing makes the judgment safer; both just move where it is wrong.
 */
export async function readPriorConclusions(
  database: SqlDatabase,
  entityIds: readonly string[],
  excludeCheckId: string,
): Promise<Map<string, PriorConclusion>> {
  const found = new Map<string, PriorConclusion>();
  const unique = [...new Set(entityIds)];
  for (let start = 0; start < unique.length; start += MAX_PRIOR_CONCLUSION_PARAMETERS) {
    const chunk = unique.slice(start, start + MAX_PRIOR_CONCLUSION_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 2}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT hit.entity_id, hit.check_id, answer.kind, answer.reviewer_user_id, answer.created_at
           FROM ${CONFLICTS_HIT_TABLE} AS hit
           JOIN ${CONFLICTS_DISPOSITION_TABLE} AS answer ON answer.hit_id = hit.id
          WHERE hit.check_id != ?1 AND hit.entity_id IN (${placeholders})
          ORDER BY answer.created_at ASC, answer.rowid ASC`,
      )
      .bind(excludeCheckId, ...chunk)
      .all<{
        entity_id: string;
        check_id: string;
        kind: string;
        reviewer_user_id: string;
        created_at: string;
      }>();
    // Ascending, then last-write-wins per entity: the MOST RECENT earlier answer is the one a
    // reviewer needs, and reading it this way keeps the rowid tie-break the rest of this module
    // uses rather than inventing a second rule for the same question.
    for (const row of results) {
      found.set(row.entity_id, {
        entityId: row.entity_id,
        checkId: row.check_id,
        kind: row.kind as DispositionKind,
        reviewerUserId: row.reviewer_user_id,
        createdAt: row.created_at,
      });
    }
  }
  return found;
}

export async function readCurrentDisposition(
  database: SqlDatabase,
  hitId: string,
): Promise<DispositionRow | null> {
  const { results } = await database
    .prepare(
      `SELECT id, hit_id, kind, rationale, reviewer_user_id, waiver_given_by_entity_id, waiver_confirmed_in_writing, waiver_document_file_id, waiver_given_on, created_at FROM ${CONFLICTS_DISPOSITION_TABLE} WHERE hit_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(hitId)
    .all<{
      id: string;
      hit_id: string;
      kind: string;
      rationale: string;
      reviewer_user_id: string;
      waiver_given_by_entity_id: string | null;
      waiver_confirmed_in_writing: number | null;
      waiver_document_file_id: string | null;
      waiver_given_on: string | null;
      created_at: string;
    }>();
  const row = results[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    hitId: row.hit_id,
    kind: row.kind as DispositionKind,
    rationale: row.rationale,
    reviewerUserId: row.reviewer_user_id,
    waiver: waiverFromRow(row),
    createdAt: row.created_at,
  };
}

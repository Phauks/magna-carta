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

// A reviewer's adjudication of one conflicts_hit row. Every call appends a new conflicts_disposition
// row — the table is append-only (see the migration's RAISE(ABORT) triggers) — so a reviewer who
// clears a hit and later reverses that call leaves BOTH rows on the books. The reversal is not an
// edit; it is a second act, and the audit trail is the point.
//
// wall_erected records that an ethical wall was put in place as an OUTCOME of adjudication — it
// enforces nothing by itself. No access restriction follows from writing this row; that enforcement,
// if and when it is built, is a separate mechanism entirely.
export interface RecordDispositionInput {
  readonly hitId: string;
  readonly kind: DispositionKind;
  readonly rationale: string;
  readonly reviewerUserId: UserId;
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

export interface DispositionRow {
  readonly id: string;
  readonly hitId: string;
  readonly kind: DispositionKind;
  readonly rationale: string;
  readonly reviewerUserId: string;
  readonly createdAt: string;
}

async function hitExists(database: SqlDatabase, hitId: string): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT id FROM ${CONFLICTS_HIT_TABLE} WHERE id = ?1`)
    .bind(hitId)
    .all<{ id: string }>();
  return results.length > 0;
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
            createdAt: row.disposition_created_at,
          },
  }));
}

export async function readCurrentDisposition(
  database: SqlDatabase,
  hitId: string,
): Promise<DispositionRow | null> {
  const { results } = await database
    .prepare(
      `SELECT id, hit_id, kind, rationale, reviewer_user_id, created_at FROM conflicts_disposition WHERE hit_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(hitId)
    .all<{
      id: string;
      hit_id: string;
      kind: string;
      rationale: string;
      reviewer_user_id: string;
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
    createdAt: row.created_at,
  };
}

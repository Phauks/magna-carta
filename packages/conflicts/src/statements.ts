import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  ConflictsCheckId,
  ConflictsDispositionId,
  ConflictsHitId,
} from "@magna-carta/identifiers/types";
import type { UserId } from "@magna-carta/identifiers/types";
import type {
  ConflictsTrigger,
  ConflictsTriggerSource,
  DispositionKind,
  EvidenceTier,
  SourceClass,
  Strictness,
} from "./types.ts";
import type { StoredWaiver } from "./waiver.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. The three tables are append-only (RAISE(ABORT) triggers on UPDATE/DELETE in the migration) —
// every statement here is an INSERT; there is no update or delete builder for any of them.
export const CONFLICTS_CHECK_TABLE = "conflicts_check";
export const CONFLICTS_HIT_TABLE = "conflicts_hit";
export const CONFLICTS_DISPOSITION_TABLE = "conflicts_disposition";

// One conflicts_check row: the full record of a single run — what was asked for, what actually ran
// (scope_json), and what fed the search (inputs_json, by reference only). subject_matter_id is null
// for a pre-consult check against a prospective party set that has no matter yet.
export interface InsertCheckRow {
  readonly id: ConflictsCheckId;
  readonly trigger: ConflictsTrigger;
  readonly subjectMatterId: string | null;
  readonly subjectPartiesJson: string;
  readonly scopeJson: string;
  readonly strictness: Strictness;
  readonly depth: number;
  readonly inputsJson: string;
  readonly floorRaised: boolean;
  readonly actorUserId: UserId | null;
  // How the run was started. Null on a run a person asked for, which reads exactly as every row
  // written before the automated paths existed does.
  readonly triggerSource: ConflictsTriggerSource | null;
  // The corpus changes an automated run covers, as JSON. Null for a manual run.
  readonly causeJson: string | null;
  readonly createdAt: string;
}

export function insertCheckStatement(database: SqlDatabase, row: InsertCheckRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CONFLICTS_CHECK_TABLE} (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, trigger_source, cause_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      row.id,
      row.trigger,
      row.subjectMatterId,
      row.subjectPartiesJson,
      row.scopeJson,
      row.strictness,
      row.depth,
      row.inputsJson,
      row.floorRaised ? 1 : 0,
      row.actorUserId,
      row.triggerSource,
      row.causeJson,
      row.createdAt,
    );
}

// One conflicts_hit row: a surfaced candidate for a check, with its evidence tier and the connecting
// graph path (an empty array when the entity was reached directly, never omitted).
export interface InsertHitRow {
  readonly id: ConflictsHitId;
  readonly checkId: ConflictsCheckId;
  readonly entityId: string;
  readonly sourceClass: SourceClass;
  readonly evidenceTier: EvidenceTier;
  readonly matchedFieldsJson: string;
  readonly graphPathJson: string;
  // True when the matched entity is itself a subject party of this check (a co-party surfacing).
  readonly coParty: boolean;
  readonly createdAt: string;
}

export function insertHitStatement(database: SqlDatabase, row: InsertHitRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CONFLICTS_HIT_TABLE} (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, co_party, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      row.id,
      row.checkId,
      row.entityId,
      row.sourceClass,
      row.evidenceTier,
      row.matchedFieldsJson,
      row.graphPathJson,
      row.coParty ? 1 : 0,
      row.createdAt,
    );
}

// One conflicts_disposition row: a reviewer's adjudication of a single hit. Every disposition is a
// new row — a reversal is a second row, never an edit of the first (the table is append-only).
//
// The four waiver columns are null on every kind but `waiver_obtained`, and a database trigger
// refuses a row that says otherwise. They are written on the INSERT like everything else: a waiver
// whose confirmation is filed later is a second disposition row, not an update of this one.
export interface InsertDispositionRow {
  readonly id: ConflictsDispositionId;
  readonly hitId: ConflictsHitId;
  readonly kind: DispositionKind;
  readonly rationale: string;
  readonly reviewerUserId: UserId;
  readonly waiver: StoredWaiver | null;
  readonly createdAt: string;
}

export function insertDispositionStatement(
  database: SqlDatabase,
  row: InsertDispositionRow,
): SqlStatement {
  const waiver = row.waiver;
  return database
    .prepare(
      `INSERT INTO ${CONFLICTS_DISPOSITION_TABLE} (id, hit_id, kind, rationale, reviewer_user_id, waiver_given_by_entity_id, waiver_confirmed_in_writing, waiver_document_file_id, waiver_given_on, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      row.id,
      row.hitId,
      row.kind,
      row.rationale,
      row.reviewerUserId,
      waiver?.givenByEntityId ?? null,
      // Stored as SQLite's own 0/1 rather than as a JavaScript boolean, so the column's
      // `IN (0, 1)` shape check and the read-side mapping agree on one encoding.
      waiver === null || waiver === undefined || waiver.confirmedInWriting === null
        ? null
        : waiver.confirmedInWriting
          ? 1
          : 0,
      waiver?.documentFileId ?? null,
      waiver?.givenOn ?? null,
      row.createdAt,
    );
}

// ---- reading the log back ---------------------------------------------------------------------

/*
 * The checks a firm has run, newest first, keyset-paginated over (created_at, id).
 *
 * TWO SHAPES OF READ, ONE STATEMENT, AND THEY PLAN DIFFERENTLY. Filtered by matter, the table's
 * (subject_matter_id, created_at, id) index serves both the narrowing and the order — which is what
 * that index was added for. UNFILTERED, there is no index leading with created_at, so the firm-wide
 * listing sorts what it reads. That is measured rather than assumed: see the plan assertion in
 * packages/fixtures/src/load-profile/conflicts-measurements.ts, which is what would catch it
 * degrading into a scan of every check the firm has ever run.
 *
 * The row is deliberately NARROW — it is a listing, and the whole check with its hits and its
 * statement is one identifier away. Reading inputs_json here would carry the recorded scope of every
 * check on the page for a surface that shows none of it.
 */
export interface ConflictsCheckSummaryRow {
  readonly id: string;
  readonly trigger: string;
  readonly subject_matter_id: string | null;
  readonly strictness: string;
  readonly depth: number;
  readonly floor_raised: number;
  readonly actor_user_id: string | null;
  readonly trigger_source: string | null;
  readonly created_at: string;
  /** Counted in the same read: a listing that could not say how many candidates surfaced would
   * make a reader open every row to find the one that matters. */
  readonly hit_count: number;
}

export function selectConflictsChecksStatement(
  database: SqlDatabase,
  options: {
    readonly matterId?: string;
    readonly cursor?: { readonly createdAt: string; readonly id: string };
    readonly limit: number;
  },
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (options.matterId !== undefined) {
    conditions.push(`${CONFLICTS_CHECK_TABLE}.subject_matter_id = ?`);
    bindings.push(options.matterId);
  }
  if (options.cursor !== undefined) {
    conditions.push(
      `(${CONFLICTS_CHECK_TABLE}.created_at < ? OR (${CONFLICTS_CHECK_TABLE}.created_at = ? AND ${CONFLICTS_CHECK_TABLE}.id < ?))`,
    );
    bindings.push(options.cursor.createdAt, options.cursor.createdAt, options.cursor.id);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${CONFLICTS_CHECK_TABLE}.id, ${CONFLICTS_CHECK_TABLE}.trigger, ` +
        `${CONFLICTS_CHECK_TABLE}.subject_matter_id, ${CONFLICTS_CHECK_TABLE}.strictness, ` +
        `${CONFLICTS_CHECK_TABLE}.depth, ${CONFLICTS_CHECK_TABLE}.floor_raised, ` +
        `${CONFLICTS_CHECK_TABLE}.actor_user_id, ${CONFLICTS_CHECK_TABLE}.trigger_source, ` +
        `${CONFLICTS_CHECK_TABLE}.created_at, ` +
        // A correlated count rather than a GROUP BY join: the page is at most a few dozen rows, the
        // (check_id) index on conflicts_hit serves each one, and a join would have to de-duplicate
        // the check row per hit before the limit could be applied.
        `(SELECT COUNT(*) FROM ${CONFLICTS_HIT_TABLE} WHERE ${CONFLICTS_HIT_TABLE}.check_id = ${CONFLICTS_CHECK_TABLE}.id) AS hit_count ` +
        `FROM ${CONFLICTS_CHECK_TABLE} ${where} ` +
        `ORDER BY ${CONFLICTS_CHECK_TABLE}.created_at DESC, ${CONFLICTS_CHECK_TABLE}.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

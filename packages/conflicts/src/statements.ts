import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  ConflictsCheckId,
  ConflictsDispositionId,
  ConflictsHitId,
} from "@magna-carta/identifiers/types";
import type { UserId } from "@magna-carta/identifiers/types";
import type {
  ConflictsTrigger,
  DispositionKind,
  EvidenceTier,
  SourceClass,
  Strictness,
} from "./types.ts";

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
  readonly createdAt: string;
}

export function insertCheckStatement(database: SqlDatabase, row: InsertCheckRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CONFLICTS_CHECK_TABLE} (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
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
export interface InsertDispositionRow {
  readonly id: ConflictsDispositionId;
  readonly hitId: ConflictsHitId;
  readonly kind: DispositionKind;
  readonly rationale: string;
  readonly reviewerUserId: UserId;
  readonly createdAt: string;
}

export function insertDispositionStatement(
  database: SqlDatabase,
  row: InsertDispositionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CONFLICTS_DISPOSITION_TABLE} (id, hit_id, kind, rationale, reviewer_user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(row.id, row.hitId, row.kind, row.rationale, row.reviewerUserId, row.createdAt);
}

import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { askableTerm, likePattern, LIKE_ESCAPE_CLAUSE } from "@magna-carta/data-access/like-search";
import { normalizeName } from "@magna-carta/directory/normalize-name";
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
 * The checks a firm refers to, newest first, keyset-paginated over the numbered check's
 * (created_at, id).
 *
 * ONE ROW PER CHECK, NOT PER RUN. A check that has been run three times is one line of the log
 * carrying its latest run's facts and how many runs it has had; the runs are read on the check
 * (docs/conventions/conflicts-rulings.md, R7). The latest run's search record supplies the band it
 * ran under, whether the floor widened it and how many candidates it surfaced; a run still in
 * flight has no record yet and those read as absent.
 *
 * TWO SHAPES OF READ, ONE STATEMENT. Filtered by matter, the (subject_matter_id, created_at, id)
 * index serves both the narrowing and the order; unfiltered, the (created_at, id) index does. The
 * matter narrowing is on where the check is FILED, which is the numbered check's matter, so a check
 * filed on a matter after it first ran belongs to that matter's history from the moment it is filed.
 *
 * The row is deliberately NARROW — it is a listing, and the whole check with its runs, its record
 * and its hits is one identifier away.
 */
export interface ConflictsCheckSummaryRow {
  readonly id: string;
  readonly check_number: string;
  readonly subject_matter_id: string | null;
  readonly created_at: string;
  readonly created_by_user_id: string | null;
  readonly latest_run_id: string | null;
  readonly run_count: number;
  readonly run_status: string | null;
  readonly latest_run_at: string | null;
  readonly trigger: string | null;
  readonly trigger_source: string | null;
  readonly requested_by_user_id: string | null;
  readonly strictness: string | null;
  readonly floor_raised: number | null;
  /** Counted in the same read: a listing that could not say how many candidates surfaced would
   * make a reader open every row to find the one that matters. Null while the latest run has no
   * record yet. */
  readonly hit_count: number | null;
  /** The latest run's stored request, read for who it searches. Null before any run exists. */
  readonly request_json: string | null;
  // Set when a member stopped the latest run; the list reports such a run as cancelled.
  readonly run_cancelled_at: string | null;
}

const NUMBERED_CHECK_TABLE = "conflicts_numbered_check";
const CHECK_RUN_TABLE = "conflicts_check_run";

/*
 * WHAT A SEARCH OVER THE LOG CAN MATCH, and why it is these two things.
 *
 * The numbered check itself holds almost no text a person would type. The trigger, the strictness
 * and the trigger source are closed labels the register already narrows by from its own column
 * filters — a set filter offers "New Party" and matches it exactly, which is strictly better than a
 * substring scan for the same thing — and `inputs_json` on the search record holds identifiers BY
 * REFERENCE, never a plaintext name, which is the whole point of that column.
 *
 * So the search answers the two questions the column filters cannot:
 *
 *   * WHICH MATTER is this check filed on — its number or its title. The first thing anybody types.
 *     Matched against the NUMBERED check's matter, which is the one the register's row shows; the
 *     matter a given run searched stays on that run's own record and is a different question.
 *   * WHOSE NAME has this check surfaced. "Have we ever checked Henderson" is a
 *     professional-responsibility question with a date on it, and before this there was no way to
 *     ask it short of opening every check in the log.
 *
 * THE NAME ARM REACHES EVERY RUN OF THE CHECK, not only its latest. The listing shows the latest
 * run, but the question being asked is about the firm's history: a name that surfaced on the first
 * run and not on the re-run after a waiver still surfaced, and a search that could not find it would
 * answer "no" to the one question this log exists to answer. So it walks the check's runs rather
 * than the `record` the row happens to be displaying.
 *
 * The name half goes through the directory's stored `normalized_display`, so the term is normalized
 * the same way the corpus was (`normalizeName` in @magna-carta/directory) and `O'Brien` finds
 * `OBrien`. It is a LIKE rather than the trigram FTS `searchNames` uses: this is narrowing a paged
 * register in date order, not ranking names by relevance, and a bm25 score is not a key a keyset
 * cursor can page over.
 */
function checkSearchCondition(term: string): { condition: string; bindings: readonly unknown[] } {
  const literal = likePattern(term);
  const arms = [
    `EXISTS (SELECT 1 FROM matter WHERE matter.id = numbered.subject_matter_id ` +
      `AND (matter.matter_number LIKE ? ${LIKE_ESCAPE_CLAUSE} OR matter.title LIKE ? ${LIKE_ESCAPE_CLAUSE}))`,
  ];
  const bindings: unknown[] = [literal, literal];

  /*
   * The name arm is DROPPED when the term normalizes away to nothing, and that guard is not
   * defensive tidiness — without it the arm is a match-everything.
   *
   * `normalizeName` strips punctuation, so a term of `%`, `&` or `...` normalizes to the empty
   * string; a contains-pattern built from an empty term is `%%`, which every stored name matches.
   * The reader would have typed one stray character and been handed the firm's entire conflicts
   * log as though every check had surfaced their query.
   */
  const normalized = normalizeName(term);
  if (normalized !== "") {
    // Correlated rather than joined: a check matches once however many of its runs and hits match,
    // and a join would have to de-duplicate the check row before the limit could be applied.
    arms.push(
      `EXISTS (SELECT 1 FROM ${CHECK_RUN_TABLE} AS search_run ` +
        `JOIN ${CONFLICTS_HIT_TABLE} ON ${CONFLICTS_HIT_TABLE}.check_id = search_run.id ` +
        `JOIN directory_name ON directory_name.entity_id = ${CONFLICTS_HIT_TABLE}.entity_id ` +
        `WHERE search_run.numbered_check_id = numbered.id ` +
        `AND directory_name.deleted_at IS NULL ` +
        `AND directory_name.normalized_display LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
    );
    bindings.push(likePattern(normalized));
  }
  return { condition: `(${arms.join(" OR ")})`, bindings };
}

export function selectConflictsChecksStatement(
  database: SqlDatabase,
  options: {
    readonly matterId?: string;
    /** Narrows to the checks a term reaches — see `checkSearchCondition`. */
    readonly search?: string;
    readonly cursor?: { readonly createdAt: string; readonly id: string };
    readonly limit: number;
  },
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (options.matterId !== undefined) {
    conditions.push(`numbered.subject_matter_id = ?`);
    bindings.push(options.matterId);
  }
  const term = askableTerm(options.search);
  if (term !== undefined) {
    const search = checkSearchCondition(term);
    conditions.push(search.condition);
    bindings.push(...search.bindings);
  }
  if (options.cursor !== undefined) {
    conditions.push(`(numbered.created_at < ? OR (numbered.created_at = ? AND numbered.id < ?))`);
    bindings.push(options.cursor.createdAt, options.cursor.createdAt, options.cursor.id);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT numbered.id, numbered.check_number, numbered.subject_matter_id, numbered.created_at, ` +
        `numbered.created_by_user_id, numbered.latest_run_id, ` +
        `COALESCE(run.ordinal, 0) AS run_count, run.status AS run_status, run.created_at AS latest_run_at, ` +
        `run.trigger, run.trigger_source, run.requested_by_user_id, run.request_json, run.cancelled_at AS run_cancelled_at, ` +
        `record.strictness, record.floor_raised, ` +
        // A correlated count rather than a GROUP BY join: the page is at most a few dozen rows, the
        // (check_id) index on conflicts_hit serves each one, and a join would have to de-duplicate
        // the check row per hit before the limit could be applied. Null, not zero, while the latest
        // run has no record: a search still running has surfaced nothing YET, which is not a count.
        `CASE WHEN record.id IS NULL THEN NULL ELSE (SELECT COUNT(*) FROM ${CONFLICTS_HIT_TABLE} WHERE ${CONFLICTS_HIT_TABLE}.check_id = record.id) END AS hit_count ` +
        `FROM ${NUMBERED_CHECK_TABLE} AS numbered ` +
        `LEFT JOIN ${CHECK_RUN_TABLE} AS run ON run.id = numbered.latest_run_id ` +
        `LEFT JOIN ${CONFLICTS_CHECK_TABLE} AS record ON record.id = run.id ` +
        `${where} ` +
        `ORDER BY numbered.created_at DESC, numbered.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

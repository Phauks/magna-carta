import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ConflictsCheckId, UserId } from "@magna-carta/identifiers/types";
import { drawWithBoundedRetry } from "@magna-carta/sequence-numbering/bounded-retry";
import { allocateCounterValueStatement } from "@magna-carta/sequence-numbering/counter-statements";
import type { RenderContext } from "@magna-carta/sequence-numbering/render";
import {
  planSchemeDraw,
  previewNextNumber,
  schemeDrawOpeningStatements,
} from "@magna-carta/sequence-numbering/scheme-draw";
import { conflictsAuditStatement, type ConflictsWriteOptions } from "./audit.ts";
import {
  CONFLICTS_CHECK_NUMBERING_TABLES,
  CONFLICTS_NUMBERED_CHECK_TABLE,
  isCheckNumberConflict,
} from "./check-numbering.ts";
import { runConflictsEffect } from "./run-conflicts-effect.ts";
import type { ScopeRequest } from "./settings.ts";
import type { ConflictsTrigger, ConflictsTriggerSource } from "./types.ts";

// THE CHECK A PERSON REFERS TO, AND THE RUNS UNDER IT.
//
// The owner's rulings of 2026-09-11 (docs/conventions/conflicts-rulings.md, R1, R4, R6 and R7): a
// conflicts check has a number, it can be run again from its own screen, its runs belong together,
// and while one runs the screen says where it has got to. None of that can live on `conflicts_check`,
// which is the immutable record of one search and stays that. So this module owns the two mutable
// rows over the log — the numbered check and its runs — and the lifecycle a run moves through.
//
// A RUN IS OPENED BEFORE THE SEARCH STARTS AND SETTLED AFTER IT. Opening is one small batch: the
// numbered check (on a first run) and the run row, status `queued`, with the search it will perform
// stored on it. That is what a screen polls. Executing the search claims the run, reports progress
// onto it, and settles it in the same batch that writes the search record — so a run reads
// `completed` if and only if its record exists, and `failed` carries a sentence a person can act on.
//
// A RUN THAT STOPS REPORTING IS SETTLED AS FAILED BY WHOEVER READS IT. The search runs after its
// request has answered, and an invocation can die. A run whose heartbeat is older than
// STALE_RUN_AFTER_MILLISECONDS is not slow, it is dead, and a screen polling it forever would be
// waiting on nothing; the read settles it and says so, and Run Again is one press away.
//
// IDENTITY. A numbered check is identified by its first run's handle, and every run by the handle of
// the search record it writes — see the schema note on `conflicts_numbered_check`. So a first run's
// id is its check's id, and a re-run mints a fresh handle that names both the run and the record it
// will write.

export { CONFLICTS_NUMBERED_CHECK_TABLE };
export const CONFLICTS_CHECK_RUN_TABLE = "conflicts_check_run";

export const RUN_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

// The statuses a READ reports. A cancelled run is stored as failed with `cancelled_at` set (see the
// schema note on the column), and is told apart from a failure everywhere a person reads it.
export const REPORTED_RUN_STATUSES = [...RUN_STATUSES, "cancelled"] as const;
export type ReportedRunStatus = (typeof REPORTED_RUN_STATUSES)[number];

export function reportedRunStatus(run: {
  readonly status: RunStatus;
  readonly cancelled_at: string | null;
}): ReportedRunStatus {
  return run.status === "failed" && run.cancelled_at !== null ? "cancelled" : run.status;
}

// The sentence a cancelled run carries in its failure column. A person reads "Cancelled" on the
// screen; this is what the row says to anybody reading it raw.
export const CANCELLED_RUN_FAILURE = "A member stopped the search before it finished.";

// Where a running search is, in the order the engine actually works: it resolves what to search,
// walks the graph, matches the closure, then bounds and writes what surfaced.
export const RUN_STAGES = ["sources", "walking", "matching", "candidates"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

// What a running search has counted so far. Every field is optional because a stage reports the
// counts it has and no others; a screen shows what is present and invents nothing.
export interface RunProgress {
  readonly sourcesSearched?: number;
  readonly subjectParties?: number;
  readonly entitiesReached?: number;
  readonly entitiesMatched?: number;
  readonly candidatesSurfaced?: number;
  readonly candidatesRecorded?: number;
}

// The number a person says out loud is drawn from the firm's conflicts check numbering scheme —
// the `conflicts_check` purpose on the firm-wide numbering register — through the shared draw
// planner, exactly as a matter number is. Its shape is the firm's to write on the numbering
// settings screen; until it does, the register's default renders CC2026-00001, restarting the count
// each year, and the counter tables are check-numbering.ts's.
//
// The day the check is opened on is the UTC day of the opening instant, the platform's rule for the
// day of a recorded moment used as a key (docs/conventions/dates.md): a number is a key before it
// is a sentence, and pinned to UTC it renders the same year in every office.
function checkNumberContext(now: string): RenderContext {
  return { openedDate: civilDateOf(now) };
}

// A run left running with no heartbeat for this long is treated as dead. A heartbeat is written on
// every round of the walk and at every stage after it, so two minutes of silence is not a slow
// stage, it is an invocation that stopped: the runtime abandons work left running after a response
// at thirty seconds, and a person watching the screen should not wait five times that to be told.
export const STALE_RUN_AFTER_MILLISECONDS = 2 * 60 * 1000;

export const STALE_RUN_FAILURE =
  "The search stopped reporting before it finished, and nothing was recorded. Run it again.";

// The search a run performs, stored on the run so a later run of the same check runs the same search.
export interface StoredRunRequest {
  readonly trigger: ConflictsTrigger;
  readonly matterId: string | null;
  readonly subjectEntityIds: readonly string[];
  readonly scope: ScopeRequest;
}

export function parseStoredRunRequest(json: string): StoredRunRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const scope = record["scope"];
  if (typeof record["trigger"] !== "string" || typeof scope !== "object" || scope === null) {
    return null;
  }
  const scopeRecord = scope as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  if (typeof scopeRecord["strictness"] !== "string") return null;
  return {
    trigger: record["trigger"] as ConflictsTrigger,
    matterId: typeof record["matterId"] === "string" ? record["matterId"] : null,
    subjectEntityIds: strings(record["subjectEntityIds"]),
    scope: {
      sources: strings(scopeRecord["sources"]) as ScopeRequest["sources"],
      strictness: scopeRecord["strictness"] as ScopeRequest["strictness"],
    },
  };
}

// ---- the rows -----------------------------------------------------------------------------------

export interface NumberedCheckRow {
  readonly id: ConflictsCheckId;
  readonly check_sequence: number;
  readonly check_number: string;
  readonly subject_matter_id: string | null;
  readonly latest_run_id: ConflictsCheckId | null;
  readonly created_by_user_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CheckRunRow {
  readonly id: ConflictsCheckId;
  readonly numbered_check_id: ConflictsCheckId;
  readonly ordinal: number;
  readonly status: RunStatus;
  readonly stage: RunStage | null;
  readonly progress_json: string | null;
  readonly request_json: string;
  readonly trigger: string;
  readonly trigger_source: string | null;
  readonly requested_by_user_id: string | null;
  readonly started_at: string | null;
  readonly heartbeat_at: string | null;
  readonly finished_at: string | null;
  readonly failure: string | null;
  readonly cancelled_at: string | null;
  readonly cancelled_by_user_id: string | null;
  readonly created_at: string;
}

const NUMBERED_CHECK_COLUMNS =
  "id, check_sequence, check_number, subject_matter_id, latest_run_id, created_by_user_id, created_at, updated_at";
const RUN_COLUMNS =
  "id, numbered_check_id, ordinal, status, stage, progress_json, request_json, trigger, trigger_source, requested_by_user_id, started_at, heartbeat_at, finished_at, failure, cancelled_at, cancelled_by_user_id, created_at";

export async function readNumberedCheck(
  database: SqlDatabase,
  id: string,
): Promise<NumberedCheckRow | null> {
  const { results } = await database
    .prepare(
      `SELECT ${NUMBERED_CHECK_COLUMNS} FROM ${CONFLICTS_NUMBERED_CHECK_TABLE} WHERE id = ?1`,
    )
    .bind(id)
    .all<NumberedCheckRow>();
  return results[0] ?? null;
}

export async function readRun(database: SqlDatabase, runId: string): Promise<CheckRunRow | null> {
  const { results } = await database
    .prepare(`SELECT ${RUN_COLUMNS} FROM ${CONFLICTS_CHECK_RUN_TABLE} WHERE id = ?1`)
    .bind(runId)
    .all<CheckRunRow>();
  return results[0] ?? null;
}

// The check an address names: a numbered check's own id, or any run's id — which is also the id of
// the search record it wrote, so an address written before the runs existed still lands.
export async function readNumberedCheckByAnyId(
  database: SqlDatabase,
  id: string,
): Promise<NumberedCheckRow | null> {
  const direct = await readNumberedCheck(database, id);
  if (direct !== null) return direct;
  const run = await readRun(database, id);
  return run === null ? null : readNumberedCheck(database, run.numbered_check_id);
}

export async function readRunsForCheck(
  database: SqlDatabase,
  numberedCheckId: string,
): Promise<CheckRunRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM ${CONFLICTS_CHECK_RUN_TABLE} WHERE numbered_check_id = ?1 ORDER BY ordinal ASC`,
    )
    .bind(numberedCheckId)
    .all<CheckRunRow>();
  return results;
}

// The check most recently filed on a matter, if any: where an automated re-check of that matter
// lands as a further run, so the log holds one check per matter with its history rather than a row
// per event.
export async function readLatestNumberedCheckForMatter(
  database: SqlDatabase,
  matterId: string,
): Promise<NumberedCheckRow | null> {
  const { results } = await database
    .prepare(
      `SELECT ${NUMBERED_CHECK_COLUMNS} FROM ${CONFLICTS_NUMBERED_CHECK_TABLE} WHERE subject_matter_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(matterId)
    .all<NumberedCheckRow>();
  return results[0] ?? null;
}

// The number the next check would draw, for the screen that opens one: a record a person quotes
// out loud is identified before it is saved (docs/conventions/design-corrections.md). A preview,
// never a reservation — the planner reads the scheme and the counter and composes nothing.
export function previewNextCheckNumber(database: SqlDatabase, now: string): Promise<string> {
  return previewNextNumber(
    database,
    "conflicts_check",
    CONFLICTS_CHECK_NUMBERING_TABLES,
    checkNumberContext(now),
  );
}

export function parseRunProgress(json: string | null): RunProgress {
  if (json === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const record = parsed as Record<string, unknown>;
  const count = (key: keyof RunProgress): number | undefined => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const progress: Record<string, number> = {};
  for (const key of [
    "sourcesSearched",
    "subjectParties",
    "entitiesReached",
    "entitiesMatched",
    "candidatesSurfaced",
    "candidatesRecorded",
  ] as const) {
    const value = count(key);
    if (value !== undefined) progress[key] = value;
  }
  return progress;
}

// ---- the statements -----------------------------------------------------------------------------

function insertNumberedCheckStatement(
  database: SqlDatabase,
  row: {
    readonly id: ConflictsCheckId;
    readonly sequence: number; // the counter value the draw consumed, under the scheme's scope
    readonly checkNumber: string; // the rendered number the firm's scheme produced for it
    readonly subjectMatterId: string | null;
    readonly createdByUserId: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CONFLICTS_NUMBERED_CHECK_TABLE} (id, check_sequence, check_number, subject_matter_id, latest_run_id, created_by_user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?1, ?5, ?6, ?6)`,
    )
    .bind(row.id, row.sequence, row.checkNumber, row.subjectMatterId, row.createdByUserId, row.now);
}

function insertRunStatement(
  database: SqlDatabase,
  row: {
    readonly id: ConflictsCheckId;
    readonly numberedCheckId: ConflictsCheckId;
    readonly ordinal: number;
    readonly request: StoredRunRequest;
    readonly triggerSource: ConflictsTriggerSource | null;
    readonly requestedByUserId: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CONFLICTS_CHECK_RUN_TABLE} (id, numbered_check_id, ordinal, status, request_json, trigger, trigger_source, requested_by_user_id, created_at) VALUES (?1, ?2, ?3, 'queued', ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      row.id,
      row.numberedCheckId,
      row.ordinal,
      JSON.stringify(row.request),
      row.request.trigger,
      row.triggerSource,
      row.requestedByUserId,
      row.now,
    );
}

function setLatestRunStatement(
  database: SqlDatabase,
  numberedCheckId: ConflictsCheckId,
  runId: ConflictsCheckId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONFLICTS_NUMBERED_CHECK_TABLE} SET latest_run_id = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(numberedCheckId, runId, now);
}

// Claims a queued run for execution. Guarded on the status, so a replayed request or a second
// executor finds zero rows changed and runs nothing: exactly one execution per run.
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function claimRunStatement(
  database: SqlDatabase,
  runId: ConflictsCheckId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONFLICTS_CHECK_RUN_TABLE} SET status = 'running', stage = 'sources', started_at = ?2, heartbeat_at = ?2 WHERE id = ?1 AND status = 'queued'`,
    )
    .bind(runId, now);
}

// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function reportRunProgressStatement(
  database: SqlDatabase,
  runId: ConflictsCheckId,
  stage: RunStage,
  progress: RunProgress,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONFLICTS_CHECK_RUN_TABLE} SET stage = ?2, progress_json = ?3, heartbeat_at = ?4 WHERE id = ?1 AND status = 'running'`,
    )
    .bind(runId, stage, JSON.stringify(progress), now);
}

// Settles a run as completed. Composed into the batch that writes the search record, so the two
// commit together or not at all. The stage and progress are cleared: a settled run's account is the
// record, never a stale progress line.
export function completeRunStatement(
  database: SqlDatabase,
  runId: ConflictsCheckId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONFLICTS_CHECK_RUN_TABLE} SET status = 'completed', stage = NULL, progress_json = NULL, heartbeat_at = ?2, finished_at = ?2 WHERE id = ?1 AND status = 'running'`,
    )
    .bind(runId, now);
}

// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function failRunStatement(
  database: SqlDatabase,
  runId: ConflictsCheckId,
  failure: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONFLICTS_CHECK_RUN_TABLE} SET status = 'failed', stage = NULL, progress_json = NULL, failure = ?2, heartbeat_at = ?3, finished_at = ?3 WHERE id = ?1 AND status IN ('queued', 'running')`,
    )
    .bind(runId, failure, now);
}

// Stops a run that has not settled. Guarded on the status, so a run that finished a moment before
// the press is left exactly as it finished and the caller can say so. The executor notices at its
// next progress report, which finds no running row to write to, and stops without recording.
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function cancelRunStatement(
  database: SqlDatabase,
  runId: ConflictsCheckId,
  cancelledByUserId: UserId | null,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONFLICTS_CHECK_RUN_TABLE} SET status = 'failed', stage = NULL, progress_json = NULL, failure = ?2, cancelled_at = ?3, cancelled_by_user_id = ?4, heartbeat_at = ?3, finished_at = ?3 WHERE id = ?1 AND status IN ('queued', 'running')`,
    )
    .bind(runId, CANCELLED_RUN_FAILURE, now, cancelledByUserId);
}

// ---- staleness ------------------------------------------------------------------------------------

export function runIsStale(run: CheckRunRow, now: string): boolean {
  if (run.status !== "running" && run.status !== "queued") return false;
  const lastSign = run.heartbeat_at ?? run.started_at ?? run.created_at;
  const lastSignInstant = Date.parse(lastSign);
  const nowInstant = Date.parse(now);
  if (Number.isNaN(lastSignInstant) || Number.isNaN(nowInstant)) return false;
  return nowInstant - lastSignInstant > STALE_RUN_AFTER_MILLISECONDS;
}

// Settles every stale run in the set as failed and returns the rows as they now stand. Called by the
// reads, because the read is the moment a person is looking at the row and the moment the honest
// answer is owed. Writes nothing for a run that is not stale.
export async function settleStaleRuns(
  database: SqlDatabase,
  runs: readonly CheckRunRow[],
  now: string,
): Promise<CheckRunRow[]> {
  const settled: CheckRunRow[] = [];
  for (const run of runs) {
    if (!runIsStale(run, now)) {
      settled.push(run);
      continue;
    }
    await failRunStatement(database, run.id, STALE_RUN_FAILURE, now).run();
    settled.push({
      ...run,
      status: "failed",
      stage: null,
      progress_json: null,
      failure: STALE_RUN_FAILURE,
      heartbeat_at: now,
      finished_at: now,
    });
  }
  return settled;
}

// ---- opening a run --------------------------------------------------------------------------------

export interface OpenRunInput {
  readonly request: StoredRunRequest;
  readonly triggerSource: ConflictsTriggerSource | null;
  // Where the run goes: under an existing numbered check (a re-run), or as the first run of a new one.
  readonly under: { readonly numberedCheckId: ConflictsCheckId } | null;
}

export interface OpenedRun {
  readonly numberedCheckId: ConflictsCheckId;
  readonly checkNumber: string;
  readonly runId: ConflictsCheckId;
  readonly ordinal: number;
}

/**
 * The opening as it crosses the wire. This is the body the idempotency record stores, and a replayed
 * key is answered with that stored body verbatim, so it has to BE the response a route sends — a
 * route that reshaped the value on its way out would answer the first request in one shape and the
 * retry in another. Every route that opens a run responds with exactly this.
 */
export interface OpenedRunBody {
  readonly id: ConflictsCheckId;
  readonly checkNumber: string;
  readonly runId: ConflictsCheckId;
  readonly ordinal: number;
}

export function openedRunBody(opened: OpenedRun): OpenedRunBody {
  return {
    id: opened.numberedCheckId,
    checkNumber: opened.checkNumber,
    runId: opened.runId,
    ordinal: opened.ordinal,
  };
}

function openedRunFromBody(body: unknown): OpenedRun {
  const stored = body as OpenedRunBody;
  return {
    numberedCheckId: stored.id,
    checkNumber: stored.checkNumber,
    runId: stored.runId,
    ordinal: stored.ordinal,
  };
}

export class UnknownNumberedCheckError extends Error {
  constructor(id: string) {
    super(`this firm has no check ${id}`);
    this.name = "UnknownNumberedCheckError";
  }
}

// Opens a run: the numbered check on a first run, the run row queued, the check's latest-run pointer
// moved. One small batch, idempotent on the caller's key, so a retried request opens one run.
export async function openCheckRun(
  database: BatchDatabase,
  input: OpenRunInput,
  options: ConflictsWriteOptions,
): Promise<OpenedRun> {
  const now = options.clock.now();

  if (input.under !== null) {
    const existing = await readNumberedCheck(database, input.under.numberedCheckId);
    if (existing === null) throw new UnknownNumberedCheckError(input.under.numberedCheckId);
    const runs = await readRunsForCheck(database, existing.id);
    const ordinal = (runs.at(-1)?.ordinal ?? 0) + 1;
    const runId = newIdentifier("conflictsCheck", options.randomSource);
    // The stored request carries the check's CURRENT matter: a check filed on a matter after it first
    // ran is re-run with that matter's parties, which is the point of filing it.
    const request: StoredRunRequest = { ...input.request, matterId: existing.subject_matter_id };
    const opened: OpenedRun = {
      numberedCheckId: existing.id,
      checkNumber: existing.check_number,
      runId,
      ordinal,
    };
    return runConflictsEffect(database, options.idempotency, options.clock, () => ({
      statements: [
        insertRunStatement(database, {
          id: runId,
          numberedCheckId: existing.id,
          ordinal,
          request,
          triggerSource: input.triggerSource,
          requestedByUserId: options.actorUserId,
          now,
        }),
        setLatestRunStatement(database, existing.id, runId, now),
        conflictsAuditStatement(database, options, "conflicts.check.run.opened", runId),
      ],
      outboxMessages: [],
      responseCode: 202,
      responseBody: openedRunBody(opened),
      value: opened,
      fromBody: openedRunFromBody,
    }));
  }

  // The number draw rides the shared bounded retry: a losing concurrent draw aborts its batch on
  // the allocation primary key (or on the rendered number's own unique index, where a check numbered
  // before the scheme existed drew no allocation row), the counter is advanced out of band, and the
  // attempt re-reads. Five consecutive losses on one firm's sequence is not a state anybody can be
  // told anything useful about, so giving up stays an unexpected fault the standard pipeline reports.
  return await drawWithBoundedRetry(
    database,
    CONFLICTS_CHECK_NUMBERING_TABLES,
    {
      sequenceLabel: "conflicts check number",
      alsoRetryable: isCheckNumberConflict,
      nonConvergenceError: ({ message, lastError }) => new Error(message, { cause: lastError }),
    },
    async (observe) => {
      // Minted per attempt: a losing batch rolled its rows back with everything else, so the retry
      // lands a genuinely new check rather than re-proposing an identifier that lost.
      const id = newIdentifier("conflictsCheck", options.randomSource);
      // Planned before the effect is built, because the effect builds eagerly and synchronously.
      // The plan is two reads and no write, so a replayed key that never executes the batch has
      // consumed nothing by planning.
      const plan = await planSchemeDraw(
        database,
        "conflicts_check",
        CONFLICTS_CHECK_NUMBERING_TABLES,
        checkNumberContext(now),
      );
      // Reported before the batch is composed, so a losing attempt can advance THIS scope's
      // counter out of band — the in-batch increment rolls back with everything else.
      observe({
        scopeKey: plan.scopeKey,
        observedValue: plan.observedValue,
        startValue: plan.startValue,
      });
      const opened: OpenedRun = {
        numberedCheckId: id,
        checkNumber: plan.number,
        runId: id,
        ordinal: 1,
      };
      return await runConflictsEffect(database, options.idempotency, options.clock, () => {
        return {
          statements: [
            ...schemeDrawOpeningStatements(database, CONFLICTS_CHECK_NUMBERING_TABLES, plan),
            insertNumberedCheckStatement(database, {
              id,
              sequence: plan.observedValue,
              checkNumber: plan.number,
              subjectMatterId: input.request.matterId,
              createdByUserId: options.actorUserId,
              now,
            }),
            insertRunStatement(database, {
              id,
              numberedCheckId: id,
              ordinal: 1,
              request: input.request,
              triggerSource: input.triggerSource,
              requestedByUserId: options.actorUserId,
              now,
            }),
            conflictsAuditStatement(database, options, "conflicts.check.opened", id),
            // Last: check_id is a foreign key, so the numbered check has to exist by the time the
            // allocation lands.
            allocateCounterValueStatement(
              database,
              CONFLICTS_CHECK_NUMBERING_TABLES,
              plan.scopeKey,
              plan.observedValue,
              id,
              now,
            ),
          ],
          outboxMessages: [],
          responseCode: 202,
          responseBody: openedRunBody(opened),
          value: opened,
          fromBody: openedRunFromBody,
        };
      });
    },
  );
}

// Files a check on a matter, or moves it. The search record is untouched — it says which matter the
// search actually used — and the next run of the check runs with this matter's parties.
export function fileCheckOnMatterStatement(
  database: SqlDatabase,
  numberedCheckId: ConflictsCheckId,
  matterId: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONFLICTS_NUMBERED_CHECK_TABLE} SET subject_matter_id = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(numberedCheckId, matterId, now);
}

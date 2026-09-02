import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { TimeEntryId, UserId } from "@magna-carta/identifiers/types";
import { IllegalTransitionError } from "@magna-carta/billing-core/lifecycle-error";
import { assertTransition, isFrozen, type TimeEntryStatus } from "./lifecycle.ts";
import type { RateSource } from "./rate-resolution.ts";
import {
  insertTimeEntryStatement,
  selectMatterEBillingStatement,
  selectTaskMatterStatement,
  selectTimeEntryMatterStatement,
  selectTimeEntryStatusStatement,
  setKickBackReasonStatement,
  transitionStatusStatement,
  updateDraftStatement,
  type DraftPatch,
  type TimeEntrySource,
} from "./time-entry-statements.ts";
import { TimeEntryValidationError } from "./time-entry-validation.ts";

// Maps the generic billing-core error to the timekeeping-domain error so the HTTP layer sees only
// TimeEntryValidationError at the 409 boundary.
function guardedAssertTransition(
  from: TimeEntryStatus,
  to: TimeEntryStatus,
  gateOn: boolean,
): void {
  try {
    assertTransition(from, to, gateOn);
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      throw new TimeEntryValidationError(
        "illegal-transition",
        `cannot move a time entry from ${error.from} to ${error.to} (review gate ${error.gateOn ? "on" : "off"})`,
      );
    }
    throw error;
  }
}

// Wall-clock and actor arrive from the caller — the service reads no clock and trusts no ambient
// identity. randomSource lets fixtures mint byte-deterministic ids. Mirrors ShipmentServiceOptions.
export interface ClockPort {
  now(): string;
}

export interface TimekeepingServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// The resolved rate the route hands in: Task-7 RateResolution widened with the Task-4-computed
// amount_minor, so the service stores a frozen snapshot and never re-resolves or re-multiplies.
export type CaptureRate =
  | {
      readonly rateE4: number;
      readonly rateCardId: string;
      readonly rateSource: RateSource;
      readonly currency: string;
      readonly amountMinor: number;
    }
  | { readonly noRate: true };

export interface CaptureTimeEntryInput {
  // An explicit id may be supplied by the caller to derive the entry handle deterministically from
  // an external token (the timer stop-commit path derives it from live_run_id so two racing commits
  // collapse to one row). When absent the service mints a fresh identifier.
  readonly id?: TimeEntryId;
  readonly matterId: string;
  readonly timekeeperUserId: string;
  readonly workDate: string;
  readonly rawDurationMinutes: number;
  readonly durationMinutes: number;
  readonly narrative: string;
  readonly billable: boolean;
  readonly nonBillableCategoryId?: string;
  readonly source: TimeEntrySource;
  readonly utbmsTaskCodeId?: string;
  readonly utbmsActivityCodeId?: string;
  readonly liveRunId?: string;
  // The task this time was worked on, when the timekeeper named one. Must be a task on this same
  // matter; assertTaskOnMatter refuses anything else.
  readonly taskId?: string;
  // The firm-internal memo. Optional at capture; the text never rides an audit row.
  readonly memo?: string;
  // The matter-scoped entry number the route drew for this capture (see entry-numbering.ts).
  // Absent = stored null: a caller with no sequence (fixtures) records an honest gap.
  readonly entryNumber?: string;
  readonly currency: string;
  readonly rate: CaptureRate;
}

function audit(
  database: SqlDatabase,
  options: TimekeepingServiceOptions,
  event: string,
  subjectId: string,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

// THE ONE RULE THE SCHEMA CANNOT HOLD. A time entry names at most one task, and that task must be on
// the entry's own matter.
//
// Two ways to get it wrong, and they fail for different reasons. A task on ANOTHER matter would let
// one matter's time point at work another matter is paying for — the kind of link that survives into
// a bill and is discovered by a client. A task on NO matter is the firm's own work (renewing the
// policy, interviewing a candidate), and no client matter can be the thing that pays for it; a null
// matter here is a refusal, never a wildcard that matches everything.
//
// SQLite cannot express either check without a trigger, so this is the enforcement and its tests are
// what keep it honest.
async function assertTaskOnMatter(
  database: SqlDatabase,
  taskId: string,
  matterId: string,
): Promise<void> {
  const { results } = await selectTaskMatterStatement(database, taskId).all<{
    matter_id: string | null;
  }>();
  if (results.length === 0) {
    throw new TimeEntryValidationError("task-not-on-matter", `no such task: ${taskId}`);
  }
  const taskMatterId = results[0]?.matter_id ?? null;
  if (taskMatterId === null) {
    throw new TimeEntryValidationError(
      "task-not-on-matter",
      `task ${taskId} is on no matter, so no matter's time can be worked on it`,
    );
  }
  if (taskMatterId !== matterId) {
    throw new TimeEntryValidationError(
      "task-not-on-matter",
      `task ${taskId} is on matter ${taskMatterId}, not ${matterId}`,
    );
  }
}

async function isEBillingMatter(database: SqlDatabase, matterId: string): Promise<boolean> {
  const { results } = await selectMatterEBillingStatement(database, matterId).all<{
    e_billing: number;
  }>();
  return (results[0]?.e_billing ?? 0) === 1;
}

// The gate-aware option bag for the lifecycle methods: approvalRequired is the firm setting the route
// has already resolved (off by default), threaded so the pure state machine knows which path is legal.
export interface LifecycleOptions extends TimekeepingServiceOptions {
  readonly approvalRequired?: boolean;
}

async function loadStatus(database: SqlDatabase, id: TimeEntryId): Promise<TimeEntryStatus> {
  const { results } = await selectTimeEntryStatusStatement(database, id).all<{
    status: TimeEntryStatus;
  }>();
  const status = results[0]?.status;
  if (status === undefined) {
    throw new TimeEntryValidationError("not-found", `no such time entry: ${id}`);
  }
  return status;
}

// One transition method body: load the current status, refuse a frozen row with a human-facing code,
// assert the transition is legal for the gate, then compose the guarded UPDATE + audit. The WHERE-guard
// in transitionStatusStatement is the concurrency backstop behind the up-front status read.
async function transition(
  database: SqlDatabase,
  id: TimeEntryId,
  to: TimeEntryStatus,
  event: string,
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new TimeEntryValidationError("frozen-entry", `time entry ${id} is ${from} and frozen`);
  }
  guardedAssertTransition(from, to, options.approvalRequired ?? false);
  const updatedAt = options.clock.now();
  return {
    timeEntryId: id,
    effect: {
      statements: [
        transitionStatusStatement(database, id, from, to, updatedAt),
        audit(database, options, event, id),
      ],
      outboxMessages: [],
    },
  };
}

export async function updateDraftTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  patch: DraftPatch,
  options: TimekeepingServiceOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const status = await loadStatus(database, timeEntryId);
  if (isFrozen(status)) {
    throw new TimeEntryValidationError(
      "frozen-entry",
      `time entry ${timeEntryId} is ${status} and frozen`,
    );
  }
  if (status !== "draft") {
    throw new TimeEntryValidationError(
      "draft-only",
      `time entry ${timeEntryId} is ${status}, not draft`,
    );
  }
  // Only when the patch NAMES a task: null unlinks and needs no matter, and an absent key is not an
  // edit at all. The entry's matter is read here rather than carried on the status pre-read, so an
  // ordinary narrative edit still costs one read.
  if (typeof patch.taskId === "string") {
    const { results } = await selectTimeEntryMatterStatement(database, timeEntryId).all<{
      matter_id: string;
    }>();
    const matterId = results[0]?.matter_id;
    if (matterId === undefined) {
      throw new TimeEntryValidationError("not-found", `no such time entry: ${timeEntryId}`);
    }
    await assertTaskOnMatter(database, patch.taskId, matterId);
  }
  const updatedAt = options.clock.now();
  return {
    timeEntryId,
    effect: {
      statements: [
        updateDraftStatement(database, timeEntryId, patch, updatedAt),
        // metadata names WHICH fields the patch touched — names only, never a value, so an edited
        // memo or narrative is audited as the fact of an edit without the text ever reaching the
        // shared audit log.
        domainAuditStatement(database, {
          event: "time_entry.updated",
          subjectId: timeEntryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            fields: Object.entries(patch)
              .filter(([, value]) => value !== undefined)
              .map(([field]) => field),
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// On resubmit the timekeeper has addressed the reviewer's note, so the kick-back reason is cleared.
export async function submitTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const from = await loadStatus(database, timeEntryId);
  if (isFrozen(from)) {
    throw new TimeEntryValidationError(
      "frozen-entry",
      `time entry ${timeEntryId} is ${from} and frozen`,
    );
  }
  guardedAssertTransition(from, "submitted", options.approvalRequired ?? false);
  const updatedAt = options.clock.now();
  return {
    timeEntryId,
    effect: {
      statements: [
        transitionStatusStatement(database, timeEntryId, from, "submitted", updatedAt),
        setKickBackReasonStatement(database, timeEntryId, null, updatedAt),
        audit(database, options, "time_entry.submitted", timeEntryId),
      ],
      outboxMessages: [],
    },
  };
}

export function approveTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  return transition(database, timeEntryId, "approved", "time_entry.approved", options);
}

// Kick-back transitions the entry back to draft and stores the reviewer's reason directly on the
// entry row — the audit row records who/when but carries no free-text (audit_log.metadata is kept
// null to honour the platform convention that metadata never carries privileged content).
export async function kickBackTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  input: { reason: string },
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const from = await loadStatus(database, timeEntryId);
  if (isFrozen(from)) {
    throw new TimeEntryValidationError(
      "frozen-entry",
      `time entry ${timeEntryId} is ${from} and frozen`,
    );
  }
  guardedAssertTransition(from, "draft", options.approvalRequired ?? false);
  const updatedAt = options.clock.now();
  return {
    timeEntryId,
    effect: {
      statements: [
        transitionStatusStatement(database, timeEntryId, from, "draft", updatedAt),
        setKickBackReasonStatement(database, timeEntryId, input.reason, updatedAt),
        domainAuditStatement(database, {
          event: "time_entry.kicked_back",
          subjectId: timeEntryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Void is a terminal freeze reachable from any non-frozen state (a mistaken entry is voided, never
// hard-deleted — the row stays for audit). assertTransition permits <any non-frozen> -> void.
export async function voidTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const from = await loadStatus(database, timeEntryId);
  if (isFrozen(from)) {
    throw new TimeEntryValidationError(
      "frozen-entry",
      `time entry ${timeEntryId} is ${from} and frozen`,
    );
  }
  guardedAssertTransition(from, "void", options.approvalRequired ?? false);
  const updatedAt = options.clock.now();
  return {
    timeEntryId,
    effect: {
      statements: [
        transitionStatusStatement(database, timeEntryId, from, "void", updatedAt),
        audit(database, options, "time_entry.voided", timeEntryId),
      ],
      outboxMessages: [],
    },
  };
}

// The single WIP-store writer. The route has already resolved the rate (precedence + effective date)
// and rounded the duration, then folded both into `input.rate` — this composes the insert + audit into
// one EffectWrite. A null rate ("non-billable internal time") stores null rate columns; the table's
// amount_minor ⟺ rate_e4 paired-null CHECK keeps the two in lockstep.
export async function captureTimeEntry(
  database: SqlDatabase,
  input: CaptureTimeEntryInput,
  options: TimekeepingServiceOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  // An electronic-billing matter cannot carry a billable entry without a UTBMS task code — the LEDES
  // exporter rejects an uncoded line, so refusing here keeps an uncodeable entry out of the WIP store.
  if (
    input.billable &&
    input.utbmsTaskCodeId === undefined &&
    (await isEBillingMatter(database, input.matterId))
  ) {
    throw new TimeEntryValidationError(
      "utbms-required",
      "an electronic-billing matter requires a UTBMS task code on a billable entry",
    );
  }

  if (input.taskId !== undefined) {
    await assertTaskOnMatter(database, input.taskId, input.matterId);
  }

  const timeEntryId = input.id ?? newIdentifier("timeEntry", options.randomSource);
  const createdAt = options.clock.now();
  const billed = "noRate" in input.rate ? null : input.rate;

  return {
    timeEntryId,
    effect: {
      statements: [
        insertTimeEntryStatement(database, {
          id: timeEntryId,
          matterId: input.matterId,
          timekeeperUserId: input.timekeeperUserId,
          workDate: input.workDate,
          durationMinutes: input.durationMinutes,
          rawDurationMinutes: input.rawDurationMinutes,
          narrative: input.narrative,
          billable: input.billable ? 1 : 0,
          nonBillableCategoryId: input.nonBillableCategoryId ?? null,
          currency: input.currency,
          rateE4: billed?.rateE4 ?? null,
          rateCardId: billed?.rateCardId ?? null,
          rateSource: billed?.rateSource ?? null,
          amountMinor: billed?.amountMinor ?? null,
          utbmsTaskCodeId: input.utbmsTaskCodeId ?? null,
          utbmsActivityCodeId: input.utbmsActivityCodeId ?? null,
          source: input.source,
          liveRunId: input.liveRunId ?? null,
          taskId: input.taskId ?? null,
          memo: input.memo ?? null,
          entryNumber: input.entryNumber ?? null,
          createdAt,
          createdBy: options.actorUserId,
        }),
        // metadata carries the capture source only — an identifier-free, non-privileged fact the
        // history read renders ("entered from the timer" vs "typed by hand").
        domainAuditStatement(database, {
          event: "time_entry.captured",
          subjectId: timeEntryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { source: input.source },
        }),
      ],
      outboxMessages: [],
    },
  };
}

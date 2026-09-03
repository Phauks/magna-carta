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
  refileStatement,
  selectMatterEBillingStatement,
  selectTimeEntryStatusStatement,
  setKickBackReasonStatement,
  transitionStatusStatement,
  updateDraftStatement,
  type DraftPatch,
  type RefilePatch,
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

/*
 * MOVING A MISFILED ENTRY ONTO THE MATTER IT BELONGS TO.
 *
 * Time gets recorded against the wrong matter — a person is on two of them in one afternoon, the
 * picker was left where it was, the timer was bound before anybody decided. Without this the only
 * remedy is to strike the entry and type it again, which loses its number, its history and its
 * attachments, and leaves a struck row on a matter it was never really on.
 *
 * WHAT MAY MOVE. A draft this account may work, on no bill and held by no claim. Past that the entry
 * is evidence somebody is relying on: an approved entry is a reviewer's decision about a matter, a
 * billed one is a line on a finalized invoice, and the answer to both is a void and a fresh record
 * rather than a move nobody can see. The refusal always says which of those it is, because "you
 * cannot" and "you cannot, because it is on invoice 2026-0031" are different sentences to be told.
 *
 * WHAT CARRIES, AND WHAT IS RE-ASKED. The entry number carries: a reference that changes is a
 * reference that lies, and anything that cited it must keep resolving. The consequence is stated
 * rather than hidden — the number's own shape names the matter it was FIRST written on, so after a
 * move that prefix is provenance and not an assertion about where the entry lives now. The
 * description, the memo, the codes, the attachments and the whole history carry untouched.
 *
 * The RATE and the ROUNDING are re-asked, because both are resolved against the matter. The rate
 * chain reads matter, then client, then timekeeper; the rounding increment resolves matter, then
 * client, then user. Carrying the old matter's answers to a new client is how a firm bills one
 * client at another's rate. This is not the snapshot invariant bending: that rule says a rate card
 * edited later never re-rates a standing entry, and it still holds — what changed here is the
 * question, not somebody's later edit to the answer. The caller resolves against the destination and
 * hands the result in, exactly as capture does.
 *
 * THE MOVE IS ON THE RECORD. One audit row naming both matters, so a reader of the entry's history
 * can see where it came from and when it moved. A move nobody can see is indistinguishable from a
 * misfiling nobody noticed.
 */
export interface RefileTimeEntryInput extends RefilePatch {
  /** The matter it is leaving, read by the caller, so the audit row can name both ends. */
  readonly fromMatterId: string;
}

export async function refileTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  input: RefileTimeEntryInput,
  options: TimekeepingServiceOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  if (input.matterId === input.fromMatterId) {
    throw new TimeEntryValidationError(
      "same-matter",
      `time entry ${timeEntryId} is already on matter ${input.matterId}`,
    );
  }
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
  const updatedAt = options.clock.now();
  return {
    timeEntryId,
    effect: {
      statements: [
        refileStatement(database, timeEntryId, input, updatedAt),
        // Both matters by name, because the question a reader asks of this event is "where did it
        // come from". No business text rides here: the audit records the move, never the entry.
        domainAuditStatement(database, {
          event: "time_entry.refiled",
          subjectId: timeEntryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { fromMatterId: input.fromMatterId, toMatterId: input.matterId },
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

/*
 * RETURNING A VOIDED ENTRY TO DRAFT.
 *
 * Voiding is how a mistaken entry is retired, and it has always been one-way: the row stays for
 * audit, carrying no value. That is right for the act and wrong for the accident. People void the
 * wrong row, void on a colleague's say-so that turns out to be mistaken, and void an afternoon's
 * work when they meant to void one line of it — and until now the only repair was to type the whole
 * entry again, which loses its number, its memo, its codes, its attached documents and its history,
 * exactly as re-typing a misfiled entry did before it could be moved.
 *
 * IT IS NOT A LIFECYCLE TRANSITION, DELIBERATELY. `canTransition` says nothing leaves a terminal
 * state, and that stays true: the forward chain must not learn a backward move, because every other
 * record kind in the product reads the same table and none of them has been designed for one. This
 * is its own guarded act with its own refusals, the way refiling is its own statement rather than a
 * field on the patch. What it restores is the state the entry was in before somebody voided it,
 * which is a draft — never submitted, never approved: those were somebody's judgement about an
 * entry that has since been withdrawn, and they have to be given again.
 *
 * THE ONE VOID THAT MUST STAY A VOID is the entry converted into a cost. That conversion moves the
 * entry's value onto a cost record and voids the time so the firm cannot count it twice; restoring
 * the time without touching the cost would do precisely what the conversion existed to prevent. The
 * conversion is recorded as an audit event on the entry and nowhere else, so that is what is asked,
 * and the caller reads it — this service takes the answer rather than the database, because the
 * question is the route's to ask alongside the reads it already makes.
 */
export async function unvoidTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  facts: {
    /** Whether this entry was voided by being converted into a cost entry. */
    readonly convertedToCost: boolean;
  },
  options: TimekeepingServiceOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const from = await loadStatus(database, timeEntryId);
  if (from !== "void") {
    throw new TimeEntryValidationError(
      "not-void",
      `time entry ${timeEntryId} is ${from}, not void — there is nothing to restore`,
    );
  }
  if (facts.convertedToCost) {
    throw new TimeEntryValidationError(
      "converted-to-cost",
      `time entry ${timeEntryId} was voided by conversion to a cost entry; restoring it would charge the same work twice`,
    );
  }
  const updatedAt = options.clock.now();
  return {
    timeEntryId,
    effect: {
      statements: [
        // Guarded on the void status, so two callers racing produce one restore: the second one
        // matches no row and the service's own read has already refused it anyway.
        transitionStatusStatement(database, timeEntryId, "void", "draft", updatedAt),
        audit(database, options, "time_entry.unvoided", timeEntryId),
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

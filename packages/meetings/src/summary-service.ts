import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectStatement, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterTaskId, MeetingSummaryId, UserId } from "@magna-carta/identifiers/types";
import {
  claimSummaryStatement,
  deleteSummaryActionItemsStatement,
  failSummaryStatement,
  insertActionItemStatement,
  insertSummaryStatement,
  readySummaryStatement,
  recordActionItemTaskStatement,
  recordSummaryModelFailureStatement,
  refuseSummaryStatement,
  rerunSummaryStatement,
  type SummaryRunUsage,
} from "./summary-statements.ts";
import type {
  MeetingSummaryActionItemRow,
  MeetingSummaryRefusalReason,
  MeetingSummaryRow,
  ParsedSummary,
} from "./summary-types.ts";
import type { MeetingTranscriptRow } from "./transcript-types.ts";

// THE SUMMARY'S ACTS ON ITS OWN RECORD — begun, claimed, written, refused, failed, asked for again, and
// an action item turned into a task — each an effect for the Worker to commit, every one that can lose a
// race guarded with a label of its own, so a caller tells "somebody got there first" from a fault.
// Nothing here reads a clock, holds a binding or calls a model; the consumer does.
//
// THE AUDIT ROWS CARRY HANDLES, COUNTS, CLOSED LABELS AND INSTANTS. Never a sentence of the summary,
// never an action item's text, never anybody's name.

/** The labels the summary's guarded writes carry, exported because a caller matches on them. */
export const SUMMARY_CLAIM_GUARD = "meeting.summary.claim";
export const SUMMARY_READY_GUARD = "meeting.summary.ready";
export const SUMMARY_REFUSE_GUARD = "meeting.summary.refuse";
export const SUMMARY_FAIL_GUARD = "meeting.summary.fail";
export const SUMMARY_MODEL_FAILURE_GUARD = "meeting.summary.model-failure";
export const SUMMARY_RERUN_GUARD = "meeting.summary.rerun";
export const SUMMARY_ACTION_ITEM_TASK_GUARD = "meeting.summary.action-item-task";

/** The platform or a member acting on the record. */
export interface MeetingSummaryOptions {
  readonly clock: { now(): string };
  readonly randomSource?: RandomSource;
}

/**
 * A READY TRANSCRIPT'S SUMMARY, BEGUN: the pending row, composed into the batch that makes the transcript
 * ready (with nobody behind it) or into a member's request for one where none exists. Whether the summary
 * is then written, and by which model, is decided when it is run — the firm's settings are read then, so
 * a switch turned off in between is honoured.
 */
export function beginSummaryStatements(
  database: SqlDatabase,
  input: {
    readonly transcript: Pick<MeetingTranscriptRow, "id" | "meeting_id" | "recording_id">;
    readonly requestedByUserId: UserId | null;
  },
  options: MeetingSummaryOptions,
): { readonly summaryId: MeetingSummaryId; readonly statements: EffectStatement[] } {
  const summaryId = newIdentifier("meetingSummary", options.randomSource);
  const now = options.clock.now();
  const statements: EffectStatement[] = [
    insertSummaryStatement(database, {
      id: summaryId,
      meetingId: input.transcript.meeting_id,
      recordingId: input.transcript.recording_id,
      transcriptId: input.transcript.id,
      requestedByUserId: input.requestedByUserId,
      now,
    }),
  ];
  if (input.requestedByUserId !== null) {
    statements.push(
      requestedAudit(database, summaryId, input.transcript, input.requestedByUserId, now, options),
    );
  }
  return { summaryId, statements };
}

// A member asked for a summary to be written — the first time, or again.
function requestedAudit(
  database: SqlDatabase,
  summaryId: MeetingSummaryId,
  transcript: Pick<MeetingTranscriptRow, "id" | "meeting_id" | "recording_id">,
  actorUserId: UserId,
  now: string,
  options: MeetingSummaryOptions,
): EffectStatement {
  return domainAuditStatement(database, {
    event: "meetings.summary.requested",
    subjectId: summaryId,
    actorUserId,
    clock: { now: () => now },
    randomSource: options.randomSource,
    metadata: {
      meetingId: transcript.meeting_id,
      recordingId: transcript.recording_id,
      transcriptId: transcript.id,
      requestedAt: now,
    },
  });
}

/**
 * ONE CONSUMER TAKES THE RUN, or is refused because another holds it or it settled. `leaseMilliseconds`
 * is how long a claim holds against another delivery: a queue consumer's own longest run.
 */
export function claimSummaryEffect(
  database: SqlDatabase,
  input: {
    readonly summary: MeetingSummaryRow;
    readonly claimedAt: string;
    readonly leaseMilliseconds: number;
  },
): EffectWrite {
  return {
    statements: [
      guarded(
        claimSummaryStatement(database, {
          id: input.summary.id,
          now: input.claimedAt,
          leaseExpiredBefore: new Date(
            Date.parse(input.claimedAt) - input.leaseMilliseconds,
          ).toISOString(),
        }),
        SUMMARY_CLAIM_GUARD,
      ),
    ],
    outboxMessages: [],
  };
}

/**
 * THE SUMMARY IS WRITTEN: `ready` with its text, every action item in order, and ONE audit row of handles
 * and counts — how many items, how many have an owner, how many a date, what the run spent — in one
 * batch, guarded on this consumer's claim.
 */
export function readySummaryStatements(
  database: SqlDatabase,
  input: {
    readonly summary: MeetingSummaryRow;
    readonly claimedAt: string;
    readonly parsed: ParsedSummary;
    readonly usage: SummaryRunUsage;
  },
  options: MeetingSummaryOptions,
): EffectStatement[] {
  const now = options.clock.now();
  return [
    guarded(
      readySummaryStatement(database, {
        id: input.summary.id,
        claimedAt: input.claimedAt,
        summaryText: input.parsed.summaryText,
        usage: input.usage,
        now,
      }),
      SUMMARY_READY_GUARD,
    ),
    ...input.parsed.actionItems.map((item, ordinal) =>
      insertActionItemStatement(database, {
        id: newIdentifier("meetingSummaryActionItem", options.randomSource),
        summaryId: input.summary.id,
        ordinal,
        text: item.text,
        ownerUserId: item.ownerUserId,
        dueOn: item.dueOn,
        now,
      }),
    ),
    domainAuditStatement(database, {
      event: "meetings.summary.ready",
      subjectId: input.summary.id,
      actorUserId: null,
      clock: { now: () => now },
      randomSource: options.randomSource,
      metadata: {
        meetingId: input.summary.meeting_id,
        recordingId: input.summary.recording_id,
        transcriptId: input.summary.transcript_id,
        modelId: input.usage.modelId,
        snapshotId: input.usage.snapshotId,
        modelCalls: input.usage.modelCalls,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        actionItemCount: input.parsed.actionItems.length,
        ownedActionItemCount: input.parsed.actionItems.filter((item) => item.ownerUserId !== null)
          .length,
        datedActionItemCount: input.parsed.actionItems.filter((item) => item.dueOn !== null).length,
        readyAt: now,
      },
    }),
  ];
}

/** A SUMMARY NOT WRITTEN, AND WHY — with ONE audit row naming the reason, guarded on this consumer's claim. */
export function refuseSummaryEffect(
  database: SqlDatabase,
  input: {
    readonly summary: MeetingSummaryRow;
    readonly claimedAt: string;
    readonly reason: MeetingSummaryRefusalReason;
    // The model the firm's choice named, when the refusal is about that model; null otherwise.
    readonly modelId: string | null;
  },
  options: MeetingSummaryOptions,
): EffectWrite {
  const now = options.clock.now();
  return {
    statements: [
      guarded(
        refuseSummaryStatement(database, {
          id: input.summary.id,
          claimedAt: input.claimedAt,
          reason: input.reason,
          modelId: input.modelId,
          now,
        }),
        SUMMARY_REFUSE_GUARD,
      ),
      domainAuditStatement(database, {
        event: "meetings.summary.refused",
        subjectId: input.summary.id,
        actorUserId: null,
        clock: { now: () => now },
        randomSource: options.randomSource,
        metadata: {
          meetingId: input.summary.meeting_id,
          recordingId: input.summary.recording_id,
          transcriptId: input.summary.transcript_id,
          reason: input.reason,
          modelId: input.modelId,
          refusedAt: now,
        },
      }),
    ],
    outboxMessages: [],
  };
}

/**
 * A SUMMARY THAT COULD NOT BE WRITTEN: `failed` with the Error ID and what the run spent, and ONE audit row
 * of handles — guarded on this consumer's claim, so the row is written only by the failure the record
 * keeps.
 */
export function failSummaryEffect(
  database: SqlDatabase,
  input: {
    readonly summary: MeetingSummaryRow;
    readonly claimedAt: string;
    readonly failureErrorId: string;
    readonly usage: SummaryRunUsage;
  },
  options: MeetingSummaryOptions,
): EffectWrite {
  const now = options.clock.now();
  return {
    statements: [
      guarded(
        failSummaryStatement(database, {
          id: input.summary.id,
          claimedAt: input.claimedAt,
          failureErrorId: input.failureErrorId,
          usage: input.usage,
          now,
        }),
        SUMMARY_FAIL_GUARD,
      ),
      domainAuditStatement(database, {
        event: "meetings.summary.failed",
        subjectId: input.summary.id,
        actorUserId: null,
        clock: { now: () => now },
        randomSource: options.randomSource,
        metadata: {
          meetingId: input.summary.meeting_id,
          recordingId: input.summary.recording_id,
          transcriptId: input.summary.transcript_id,
          failureErrorId: input.failureErrorId,
          modelId: input.usage.modelId,
          modelCalls: input.usage.modelCalls,
          failedAt: now,
        },
      }),
    ],
    outboxMessages: [],
  };
}

/** THE MODEL REFUSED FOR NOW: one more refusal counted and the claim let go, guarded on that claim. */
export function summaryModelFailureEffect(
  database: SqlDatabase,
  input: { readonly summaryId: MeetingSummaryId; readonly claimedAt: string },
  options: MeetingSummaryOptions,
): EffectWrite {
  return {
    statements: [
      guarded(
        recordSummaryModelFailureStatement(database, {
          id: input.summaryId,
          claimedAt: input.claimedAt,
          now: options.clock.now(),
        }),
        SUMMARY_MODEL_FAILURE_GUARD,
      ),
    ],
    outboxMessages: [],
  };
}

/**
 * A MEMBER ASKS FOR THE SUMMARY AGAIN: the settled summary back to `pending`, its action items gone with
 * the text they were read out of, and ONE audit row naming the member — guarded on the state and instant
 * the caller read, so two requests start one run. A task already made of an action item is the task
 * subsystem's record and stays; only the item that pointed at it goes.
 */
export function rerunSummaryEffect(
  database: SqlDatabase,
  input: { readonly summary: MeetingSummaryRow; readonly actorUserId: UserId },
  options: MeetingSummaryOptions,
): EffectWrite {
  const now = options.clock.now();
  return {
    statements: [
      guarded(
        rerunSummaryStatement(database, {
          id: input.summary.id,
          readState: input.summary.state,
          readUpdatedAt: input.summary.updated_at,
          requestedByUserId: input.actorUserId,
          now,
        }),
        SUMMARY_RERUN_GUARD,
      ),
      deleteSummaryActionItemsStatement(database, input.summary.id),
      requestedAudit(
        database,
        input.summary.id,
        {
          id: input.summary.transcript_id,
          meeting_id: input.summary.meeting_id,
          recording_id: input.summary.recording_id,
        },
        input.actorUserId,
        now,
        options,
      ),
    ],
    outboxMessages: [],
  };
}

/**
 * AN ACTION ITEM BECOMES A TASK: the task the task subsystem's own create path composed, the item marked
 * with it (guarded on its having none, so two presses make one task), and ONE audit row naming the
 * summary, the item and the task — never the item's text.
 */
export function actionItemTaskStatements(
  database: SqlDatabase,
  input: {
    readonly summary: MeetingSummaryRow;
    readonly actionItem: MeetingSummaryActionItemRow;
    readonly taskId: MatterTaskId;
    readonly actorUserId: UserId;
  },
  options: MeetingSummaryOptions,
): EffectStatement[] {
  const now = options.clock.now();
  return [
    guarded(
      recordActionItemTaskStatement(database, {
        id: input.actionItem.id,
        summaryId: input.summary.id,
        taskId: input.taskId,
        now,
      }),
      SUMMARY_ACTION_ITEM_TASK_GUARD,
    ),
    domainAuditStatement(database, {
      event: "meetings.summary.actionItemTasked",
      subjectId: input.summary.id,
      actorUserId: input.actorUserId,
      clock: { now: () => now },
      randomSource: options.randomSource,
      metadata: {
        meetingId: input.summary.meeting_id,
        recordingId: input.summary.recording_id,
        actionItemId: input.actionItem.id,
        taskId: input.taskId,
      },
    }),
  ];
}

/**
 * SOMEBODY READ A SUMMARY: ONE audit row per read of its text, naming the reader, the summary, the
 * transcript it summarizes and how many action items it held — never a sentence of it.
 */
export function summaryReadAuditStatement(
  database: SqlDatabase,
  input: {
    readonly summary: MeetingSummaryRow;
    readonly actorUserId: UserId;
    readonly actionItemCount: number;
  },
  options: MeetingSummaryOptions,
): EffectStatement {
  const now = options.clock.now();
  return domainAuditStatement(database, {
    event: "meetings.summary.read",
    subjectId: input.summary.id,
    actorUserId: input.actorUserId,
    clock: { now: () => now },
    randomSource: options.randomSource,
    metadata: {
      meetingId: input.summary.meeting_id,
      recordingId: input.summary.recording_id,
      transcriptId: input.summary.transcript_id,
      actionItemCount: input.actionItemCount,
    },
  });
}

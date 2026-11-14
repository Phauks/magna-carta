import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MagnusConversationId, MagnusTurnId } from "@magna-carta/identifiers/types";
import {
  turnCompletedAudit,
  turnFailedAudit,
  turnRemovedAudit,
  turnSubmittedAudit,
  type MagnusWriteContext,
} from "./audit.ts";
import { exceedsMagnusTurnCap, exceedsMemberTurnCap } from "./limits.ts";
import {
  completeTurnStatement,
  failTurnStatement,
  insertTurnStatement,
  recordTurnThinkingStatement,
  removeTurnPairStatement,
  supersedeTurnsFromStatement,
} from "./statements.ts";
import type { TurnFailureLabel, TurnRow } from "./types.ts";

// Turn composition. A submission writes a PAIR of rows in one batch — the member's message, already
// complete, and the Magnus turn it is waiting on, pending — because the pending row is the thing the
// client polls or subscribes to and it must exist the moment the request returns.
//
// Nothing here throws for a business outcome: an over-cap turn is a returned refusal, so the caller
// maps it onto a wire response rather than catching an exception to decide what happened.

// The topic the submitted turn rides to the queue on. It goes through the per-firm outbox in the same
// atomic batch as the rows it refers to, so a queued job can never refer to rows that did not commit
// and a committed turn can never fail to be queued.
export const MAGNUS_TURN_SUBMITTED_TOPIC = "magnus.turn_submitted";

export interface SubmitTurnInput {
  readonly conversationId: MagnusConversationId;
  readonly content: string;
  // The next free sequence, read immediately before this call. The UNIQUE (conversation_id, sequence)
  // index is what actually arbitrates a race — a loser's batch fails rather than reordering the
  // record.
  readonly nextSequence: number;
  readonly disclosureVersion: number;
  // The model and effort the member chose in the composer, already checked by the caller against the
  // catalog. Absent, the answer comes from the firm's model at that model's own default effort. Both
  // are labels, not content, so they ride the outbox payload to the consumer.
  readonly choice?: { readonly modelId: string; readonly effort: string | null };
  // Present when this submission EDITS an earlier member turn: that turn and every turn after it are
  // set aside (kept on the record, no longer read by the model), and the new pair is appended naming
  // the turn it replaces. Editing re-asks from that point rather than rewriting history in place.
  readonly replaces?: { readonly turnId: MagnusTurnId; readonly sequence: number };
}

export type SubmitTurnResult =
  | {
      readonly ok: true;
      readonly memberTurnId: MagnusTurnId;
      readonly magnusTurnId: MagnusTurnId;
      readonly effect: EffectWrite;
    }
  | { readonly ok: false; readonly failureLabel: Extract<TurnFailureLabel, "too-large"> };

export function submitTurn(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: SubmitTurnInput,
): SubmitTurnResult {
  if (exceedsMemberTurnCap(input.content)) return { ok: false, failureLabel: "too-large" };

  const memberTurnId = newIdentifier("magnusTurn", context.randomSource);
  const magnusTurnId = newIdentifier("magnusTurn", context.randomSource);
  const now = context.clock.now();

  return {
    ok: true,
    memberTurnId,
    magnusTurnId,
    effect: {
      statements: [
        ...(input.replaces === undefined
          ? []
          : [
              supersedeTurnsFromStatement(database, {
                conversationId: input.conversationId,
                fromSequence: input.replaces.sequence,
                now,
              }),
            ]),
        insertTurnStatement(database, {
          id: memberTurnId,
          conversationId: input.conversationId,
          sequence: input.nextSequence,
          speaker: "member",
          content: input.content,
          status: "complete",
          createdAt: now,
          completedAt: now,
          ...(input.replaces !== undefined && { replacesTurnId: input.replaces.turnId }),
        }),
        insertTurnStatement(database, {
          id: magnusTurnId,
          conversationId: input.conversationId,
          sequence: input.nextSequence + 1,
          speaker: "magnus",
          content: null,
          status: "pending",
          createdAt: now,
          completedAt: null,
        }),
        turnSubmittedAudit(database, context, {
          conversationId: input.conversationId,
          memberTurnId,
          magnusTurnId,
          disclosureVersion: input.disclosureVersion,
          ...(input.replaces !== undefined && { replacesTurnId: input.replaces.turnId }),
        }),
      ],
      outboxMessages: [
        {
          topic: MAGNUS_TURN_SUBMITTED_TOPIC,
          // Identifiers only. The payload is swept onto a queue and is stored as JSON in the outbox
          // table — the content stays in the turn row the consumer reads back under the firm-scoped
          // data-access layer, and travels nowhere else.
          payload: {
            conversationId: input.conversationId,
            magnusTurnId,
            memberTurnId,
            ...(input.choice === undefined
              ? {}
              : { modelId: input.choice.modelId, effort: input.choice.effort }),
          },
          aggregateKey: input.conversationId,
        },
      ],
    },
  };
}

export interface CompleteTurnInput {
  readonly conversationId: MagnusConversationId;
  readonly magnusTurnId: MagnusTurnId;
  readonly content: string;
  readonly modelId: string;
  readonly snapshotId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly contextTruncated: boolean;
  // The effort the answer was asked for, or null where none was sent.
  readonly effort: string | null;
}

export type CompleteTurnResult =
  | { readonly ok: true; readonly effect: EffectWrite }
  | { readonly ok: false; readonly failureLabel: Extract<TurnFailureLabel, "too-large"> };

export function completeTurn(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: CompleteTurnInput,
): CompleteTurnResult {
  // An answer over the cap is refused rather than truncated: a stored half-answer is a transcript
  // that disagrees with itself, and the caller settles the turn as failed instead.
  if (exceedsMagnusTurnCap(input.content)) return { ok: false, failureLabel: "too-large" };

  const now = context.clock.now();
  return {
    ok: true,
    effect: {
      statements: [
        completeTurnStatement(database, {
          id: input.magnusTurnId,
          content: input.content,
          modelId: input.modelId,
          snapshotId: input.snapshotId,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          contextTruncated: input.contextTruncated,
          effort: input.effort,
          now,
        }),
        turnCompletedAudit(database, context, {
          conversationId: input.conversationId,
          magnusTurnId: input.magnusTurnId,
          modelId: input.modelId,
          snapshotId: input.snapshotId,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// A turn that will not produce an answer settles with a closed label and nothing else. `refused` is
// the platform declining (a gate closed, the ceiling reached, the model not eligible); `failed` is
// the model or the gateway not delivering. Both are terminal and both are audited; neither carries an
// upstream body.
export function settleTurnFailure(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly magnusTurnId: MagnusTurnId;
    readonly status: "failed" | "refused";
    readonly failureLabel: TurnFailureLabel;
    readonly modelId: string | null;
  },
): EffectWrite {
  return {
    statements: [
      failTurnStatement(database, {
        id: input.magnusTurnId,
        status: input.status,
        failureLabel: input.failureLabel,
        modelId: input.modelId,
        now: context.clock.now(),
      }),
      turnFailedAudit(database, context, {
        conversationId: input.conversationId,
        magnusTurnId: input.magnusTurnId,
        failureLabel: input.failureLabel,
        modelId: input.modelId,
      }),
    ],
    outboxMessages: [],
  };
}

// Write the summary of the model's thinking so far onto a pending Magnus turn, so a reader polling the
// turn watches it arrive. Not audited: it is progress on an answer whose submission and settlement
// are both audited, and it changes nothing once the turn settles.
export async function recordTurnThinking(
  database: SqlDatabase,
  input: { readonly magnusTurnId: MagnusTurnId; readonly thinking: string },
): Promise<void> {
  await recordTurnThinkingStatement(database, {
    id: input.magnusTurnId,
    thinking: input.thinking,
  }).run();
}

// The label a removal's batch is refused under when the pair was set aside or removed between the
// route's read and the commit; the route answers it as "already-gone".
export const TURN_REMOVE_GUARD = "magnus.turn.remove";

// Why a member turn cannot be edited or removed, as a closed label the route maps to a refusal.
export type TurnChangeRefusal =
  // Not a member's message: an answer is removed with its question, never on its own.
  | "not-yours"
  // Already removed, or already set aside by an earlier edit.
  | "already-gone"
  // An answer is still being written somewhere in the conversation; changing the record under it
  // would leave that answer built on a question that no longer stands.
  | "answer-pending";

// Whether a member turn may be edited or removed. The caller has already established that the member
// owns the conversation: only its author asks in it, so every member turn in it is theirs.
export function turnChangeRefusal(turn: TurnRow, anyPending: boolean): TurnChangeRefusal | null {
  if (turn.speaker !== "member") return "not-yours";
  if (turn.removedAt !== null || turn.supersededAt !== null) return "already-gone";
  if (anyPending) return "answer-pending";
  return null;
}

// Removes a member turn. Its answer stays in the conversation where the member can still read it
// (owner ruling, 2026-11-14: the bin on a message promises that message, not the answer too). Both
// stay on the record, because a transcript is work product and is erased only with its whole
// conversation, and neither is read by the model again: the window leaves out an answer whose
// question was taken back (window.ts), since an answer to nothing would mislead it.
export function removeTurn(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly memberTurnId: MagnusTurnId;
    // The Magnus turn answering it, when there is one. It is named in the audit row and not stamped.
    readonly magnusTurnId: MagnusTurnId | null;
  },
): EffectWrite {
  const turnIds = [input.memberTurnId];
  return {
    statements: [
      guarded(
        removeTurnPairStatement(database, {
          conversationId: input.conversationId,
          turnIds,
          now: context.clock.now(),
        }),
        TURN_REMOVE_GUARD,
      ),
      turnRemovedAudit(database, context, input),
    ],
    outboxMessages: [],
  };
}

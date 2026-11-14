import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MagnusConversationId, MagnusTurnId } from "@magna-carta/identifiers/types";
import { readNewestTurn, readTurn } from "@magna-carta/magnus/statements";
import type { TurnFailureLabel, TurnStatus } from "@magna-carta/magnus/types";

// The ONE resolver behind both the turn poll endpoint and the pushed socket frame, so a turn is never
// reported two different ways. Adding a field to one and not the other is how a fallback stops being
// a fallback.

// Exactly the body the poll endpoint returns, and exactly the `state` a pushed frame carries.
export interface TurnProgressState {
  readonly turnId: string;
  readonly status: TurnStatus | "unknown";
  readonly content?: string;
  readonly failureLabel?: TurnFailureLabel;
  // True when earlier turns did not fit the request window, so the answer was built on part of the
  // conversation. Told rather than hidden: silent truncation produces a confidently wrong answer
  // built on a premise the member believes was in scope.
  readonly truncatedContext?: boolean;
  // The summary of the model's thinking so far, once the model has returned some.
  readonly thinking?: string;
}

// A turn the caller asked for by id that does not exist in this firm. Reported as a state rather than
// an absence so the socket and the poll agree on one shape.
const UNKNOWN_TURN: TurnProgressState = { turnId: "", status: "unknown" };

function stateFor(row: {
  id: MagnusTurnId;
  status: TurnStatus;
  content: string | null;
  failureLabel: TurnFailureLabel | null;
  contextTruncated: boolean;
  thinking: string | null;
}): TurnProgressState {
  return {
    turnId: row.id,
    status: row.status,
    ...(row.content !== null && { content: row.content }),
    ...(row.failureLabel !== null && { failureLabel: row.failureLabel }),
    // Present only when it is true: a client that never sees the field is looking at an answer built
    // on the whole conversation.
    ...(row.contextTruncated && { truncatedContext: true }),
    ...(row.thinking !== null && { thinking: row.thinking }),
  };
}

export async function resolveTurnProgress(
  firmDatabase: SqlDatabase,
  conversationId: MagnusConversationId,
  turnId: MagnusTurnId,
): Promise<TurnProgressState> {
  const row = await readTurn(firmDatabase, turnId);
  // The conversation is checked as well as the turn: a turn id is only meaningful inside the
  // conversation the caller was authorized against.
  if (row === undefined || row.conversationId !== conversationId) return UNKNOWN_TURN;
  return stateFor(row);
}

// What a subscriber is told: the state of the conversation's newest turn, because that is the turn
// the conversation is waiting on. Resolves through the same shape the poll returns, so a client can
// treat a pushed frame and a polled body interchangeably.
export async function resolveConversationProgress(
  firmDatabase: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<TurnProgressState> {
  const row = await readNewestTurn(firmDatabase, conversationId);
  if (row === undefined) return UNKNOWN_TURN;
  return stateFor(row);
}

// A turn that will not transition again. `pending` is the only non-terminal state; a member turn is
// written complete and never moves.
export function isTurnProgressTerminal(state: TurnProgressState): boolean {
  return state.status !== "pending";
}

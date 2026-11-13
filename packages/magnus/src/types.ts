import type {
  FileId,
  MagnusConversationId,
  MagnusTurnId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";

// The Magnus domain vocabulary. Closed unions rather than free strings: every one of these values
// reaches a constrained database column and a wire contract, and a label a client branches on must
// not be a place prose can appear.

// A conversation's lifecycle. `deleted` is a state rather than a missing row so the audited fact
// that a conversation existed and was deleted survives the content going away.
export type ConversationState = "active" | "archived" | "deleted";

// Who produced a turn. The platform's vocabulary, not a vendor's — `magnus` is the assistant, and
// there is deliberately no third speaker: the platform-authored system prompt is a structurally
// separate field on the inference request, so nothing a member types can occupy it.
export type TurnSpeaker = "member" | "magnus";

// A turn's state. A member turn is `complete` the moment it is written; a Magnus turn starts
// `pending` and settles exactly once.
export type TurnStatus = "pending" | "complete" | "failed" | "refused";

// Why a turn did not produce an answer. A CLOSED label set: it is written to a column, returned on
// the wire, and carried in an audit row, so it must never be able to hold an upstream body or any
// part of what the member typed.
//   model-unavailable — the model or the gateway failed and the failure is not retryable here
//   not-eligible      — a consent gate closed, or the selected model is not eligible to process
//                       firm content
//   ceiling-reached   — the firm's daily turn allowance was exhausted
//   too-large         — the submitted content exceeded the per-turn cap
//   cancelled         — the turn was abandoned before it settled
export type TurnFailureLabel =
  | "model-unavailable"
  | "not-eligible"
  | "ceiling-reached"
  | "too-large"
  | "cancelled";

export const TURN_FAILURE_LABELS: readonly TurnFailureLabel[] = [
  "model-unavailable",
  "not-eligible",
  "ceiling-reached",
  "too-large",
  "cancelled",
];

// One conversation as the read path returns it. No turn content here — a conversation row carries
// only its own member-supplied title.
export interface ConversationRow {
  readonly id: MagnusConversationId;
  readonly title: string | null;
  readonly createdBy: UserId;
  readonly matterId: MatterId | null;
  readonly state: ConversationState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

// One turn as the read path returns it.
export interface TurnRow {
  readonly id: MagnusTurnId;
  readonly conversationId: MagnusConversationId;
  readonly sequence: number;
  readonly speaker: TurnSpeaker;
  readonly content: string | null;
  readonly status: TurnStatus;
  readonly failureLabel: TurnFailureLabel | null;
  readonly modelId: string | null;
  readonly snapshotId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  // True when earlier turns did not fit the bounded request window, so this answer was built on part
  // of the conversation.
  readonly contextTruncated: boolean;
  // The effort the answer was asked for, or null where none was sent.
  readonly effort: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

// How a conversation listing is ordered. `date` is newest first and the default; `name` and `matter`
// group the record by what a conversation is called and by where it is kept. Every value is honoured
// by the server over the whole record, never by a client over the page it happens to hold: an order
// applied to what is loaded is not the order.
export type ConversationSort = "date" | "name" | "matter";

export const CONVERSATION_SORTS: readonly ConversationSort[] = ["date", "name", "matter"];

// What became of an attached file's text on the most recent question that carried it.
//   pending    — attached since the last question, so nothing of it has been sent yet
//   sent       — its readable text reached the model whole
//   cut        — part of it reached the model; the rest did not fit the request's budget
//   unreadable — no readable text could be taken from it, so nothing of it was sent
export type AttachmentTextStatus = "pending" | "sent" | "cut" | "unreadable";

export const ATTACHMENT_TEXT_STATUSES: readonly AttachmentTextStatus[] = [
  "pending",
  "sent",
  "cut",
  "unreadable",
];

// One file attached to a conversation BY REFERENCE. The row points at the matter's own file and
// copies nothing: the text the model sees is taken from the file's current version at the moment a
// question is asked, and is kept nowhere else.
export interface ConversationAttachmentRow {
  readonly conversationId: MagnusConversationId;
  readonly fileId: FileId;
  readonly attachedAt: string;
  readonly textStatus: AttachmentTextStatus;
  // How many bytes of the file's text were sent on the most recent question, or null before the
  // first.
  readonly textBytes: number | null;
}

// One member's acceptance of the disclosure, at the version they were shown.
export interface MemberAcknowledgementRow {
  readonly userId: UserId;
  readonly disclosureVersion: number;
  readonly acknowledgedAt: string;
}

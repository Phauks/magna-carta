/*
 * The Magnus surface's response shapes and calls. Mirrors the `magnus.*` operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * ONE RECORD, TWO SCREENS. A conversation may sit on a matter or on none, so the member's own
 * Magnus workspace and a matter's Magnus section read the same shape through two routes, and
 * neither knows the other exists. The matter filter narrows the RECORD -- which transcripts are
 * kept on that matter's file -- and says nothing about what any of those conversations was built
 * from.
 *
 * WHAT THE ASSISTANT CAN SEE IS ONLY WHAT THE MEMBER TYPED. Linking a conversation to a matter puts
 * none of that matter's content into anything the assistant is sent. Nothing in this module, and
 * nothing any surface built on it renders, may say or imply otherwise.
 *
 * NOTHING ABOUT A CONVERSATION IS EVER LOGGED. No console line, no breadcrumb, no diagnostics
 * record carrying a turn's text -- the same rule the server side holds itself to
 * (packages/magnus/CLAUDE.md). Every call here returns its content to the caller and writes it
 * nowhere else.
 */
import { formatInstant } from "@magna-carta/design-system/formatters";
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

/** What the availability read can answer. Every one of them gets its own screen. */
export const MAGNUS_AVAILABILITY_STATES = [
  "open",
  "firm-ineligible",
  "feature-disabled",
  "acknowledgement-required",
] as const;
export type MagnusAvailabilityState = (typeof MAGNUS_AVAILABILITY_STATES)[number];

export interface MagnusAvailability {
  state: MagnusAvailabilityState;
  /** The disclosure in force. Present when the member is being asked to accept it. */
  disclosureVersion?: number;
  /** What is left of the firm's daily allowance. Absent where the server did not say. */
  remainingDailyTurns?: number;
}

/**
 * Below this many turns left, the allowance is worth putting on screen.
 *
 * A firm's default allowance is in the hundreds, so printing "497 left today" on every visit is a
 * standing number nobody reads. The fact matters when it is about to bind, which is why the
 * threshold lives here as one value rather than as a number typed into a sentence.
 */
export const ALLOWANCE_WORTH_SAYING_AT = 25;

/**
 * How long a pending answer may go unremarked before the turn says so.
 *
 * A region whose data has not arrived states a stall after fifteen seconds and offers a way on
 * (`LoadingRegion`); a pending turn is not that region -- it is a question already on the record,
 * waiting -- but it owes its reader the same promise, so it makes it in the turn's own note. The
 * threshold is longer than a read's because a model answer routinely takes several seconds and a
 * note that fired on every ordinary question would be read once and ignored ever after. Past this,
 * the wait has stopped being ordinary.
 */
export const ANSWER_SLOW_AFTER_MILLISECONDS = 30_000;

/** The lifecycle a conversation carries from the day it is started. */
export type MagnusConversationState = "active" | "archived" | "deleted";

export interface MagnusConversation {
  id: string;
  /**
   * The member's own label. Null on a conversation nobody named: nothing generates a title, so an
   * unnamed conversation displays by its start instant rather than a machine's guess at its subject.
   */
  title: string | null;
  createdBy: string;
  /** Which matter's file this transcript is kept on. Null on a conversation outside every matter. */
  matterId: string | null;
  state: MagnusConversationState;
  createdAt: string;
  updatedAt: string;
}

/** Who is speaking. There is deliberately no third speaker. */
export type MagnusTurnSpeaker = "member" | "magnus";

export type MagnusTurnStatus = "pending" | "complete" | "failed" | "refused";

/** The closed set of reasons a settled turn carries no answer. */
export const TURN_FAILURE_LABELS = [
  "model-unavailable",
  "not-eligible",
  "ceiling-reached",
  "too-large",
  "cancelled",
] as const;
export type MagnusTurnFailureLabel = (typeof TURN_FAILURE_LABELS)[number];

export interface MagnusTurn {
  id: string;
  sequence: number;
  speaker: MagnusTurnSpeaker;
  /** Null while an answer is pending, and on a turn that settled without one. */
  content: string | null;
  status: MagnusTurnStatus;
  failureLabel: MagnusTurnFailureLabel | null;
  modelId: string | null;
  snapshotId: string | null;
  /** True when earlier messages did not fit, so this answer was built on part of the conversation. */
  contextTruncated: boolean;
  createdAt: string;
  completedAt: string | null;
}

/**
 * One turn's current state, as the poll returns it.
 *
 * The events socket beside it pushes byte-identical state, so moving to the socket when token
 * streaming lands changes the transport and not the surface. `unknown` is the server saying it
 * cannot find the turn to report on.
 */
export interface MagnusTurnProgress {
  turnId: string;
  status: MagnusTurnStatus | "unknown";
  content?: string;
  failureLabel?: MagnusTurnFailureLabel;
  truncatedContext?: boolean;
}

export interface MagnusConversationDetail {
  conversation: MagnusConversation;
  turns: Page<MagnusTurn>;
}

export interface MagnusAcknowledgement {
  disclosureVersion: number;
  acknowledgedAt: string;
}

export interface MagnusSubmittedTurn {
  conversationId: string;
  memberTurnId: string;
  magnusTurnId: string;
  status: "pending";
}

/**
 * What a settled failure means, in words a member can act on.
 *
 * None of these is "something went wrong". Each names what happened and what the reader's next move
 * is, because the five causes have five different answers: one is worth retrying, two are the
 * firm's settings, one is the message itself, and one is a thing the reader did.
 */
export const TURN_FAILURE_SENTENCES: Readonly<Record<MagnusTurnFailureLabel, string>> =
  Object.freeze({
    "model-unavailable":
      "The model did not answer, so this question was not put to it. Ask it again; if it keeps failing, an administrator can check the firm's assistant settings.",
    "not-eligible":
      "The firm's assistant settings closed while this question was waiting, so it was never sent. An administrator turns the assistant back on in the firm's settings.",
    "ceiling-reached":
      "The firm's daily allowance for the assistant was spent before this question was answered. The allowance resets tomorrow, and an administrator can raise it in the firm's settings.",
    "too-large":
      "The message was longer than one turn can carry, so nothing was sent. Shorten it and ask again.",
    cancelled:
      "This question was cancelled before it was answered. Ask it again if you still want it.",
  });

/** The failure sentence for a settled turn, or null where it settled with an answer. */
export function turnFailureSentence(turn: MagnusTurn): string | null {
  return turn.failureLabel === null ? null : TURN_FAILURE_SENTENCES[turn.failureLabel];
}

/**
 * What a conversation is called on screen: the member's own title, or the instant it started.
 *
 * Nothing generates a title. An unnamed conversation reads by when it began, which is a fact, where
 * a summary of its first question would be the platform writing a label out of privileged text.
 */
export function conversationDisplayName(conversation: MagnusConversation): string {
  const title = conversation.title?.trim();
  return title === undefined || title === "" ? formatInstant(conversation.createdAt) : title;
}

/**
 * When the conversation was started, for the line beneath its name -- or null where the name IS
 * that instant and the line would say it twice.
 *
 * UNNAMED IS THE ORDINARY CASE, because nothing generates a title, so the row that repeats itself
 * is the common row rather than the rare one. The test is what the reader SEES: two moments a few
 * seconds apart render as the same words, so the comparison is between the rendered strings and not
 * between the timestamps.
 *
 * It is the START and deliberately not `updatedAt`. A conversation's `updatedAt` moves when it is
 * renamed, archived or deleted and NOT when a turn is added, so a line offering it as "last active"
 * would be telling a reader something that is not true of a conversation somebody asked six
 * questions in this morning. The listing is ordered by when a conversation started, which is the
 * same fact, so the rail and the line agree.
 */
export function conversationStartedLine(conversation: MagnusConversation): string | null {
  const started = formatInstant(conversation.createdAt);
  return conversationDisplayName(conversation) === started ? null : started;
}

/** Whether the assistant can be used by this member in this firm right now. */
export function readAvailability(fetchImpl: typeof fetch): Promise<ApiOutcome<MagnusAvailability>> {
  return requestJson(fetchImpl, "/api/v1/magnus/availability");
}

export interface ConversationListFilters {
  /** Narrows the page to the transcripts kept on one matter's file. */
  matterId?: string;
}

function conversationQuery(filters: ConversationListFilters, cursor?: string): string {
  const query = new URLSearchParams();
  if (cursor !== undefined) query.set("cursor", cursor);
  if (filters.matterId !== undefined) query.set("matterId", filters.matterId);
  return query.size === 0 ? "" : `?${query.toString()}`;
}

/**
 * The caller's own conversations, newest first. With a matter filter, only the ones kept on that
 * matter's file, which is what a matter's own assistant section reads.
 */
export function listConversations(
  fetchImpl: typeof fetch,
  cursor?: string,
  filters: ConversationListFilters = {},
): Promise<ApiOutcome<Page<MagnusConversation>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations${conversationQuery(filters, cursor)}`,
  );
}

/**
 * Starts a conversation. The matter link scopes the record and nothing else: it says which matter's
 * file this transcript belongs to, and puts none of that matter's content into anything the
 * assistant is sent.
 */
export function startConversation(
  fetchImpl: typeof fetch,
  start: { title?: string | null; matterId?: string | null },
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/magnus/conversations", {
    method: "POST",
    body: start,
    idempotencyKey,
  });
}

/** One conversation with a page of its turns, newest first. */
export function readConversation(
  fetchImpl: typeof fetch,
  conversationId: string,
  cursor?: string,
): Promise<ApiOutcome<MagnusConversationDetail>> {
  const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}${query}`,
  );
}

/** Submits a message. Answers immediately with a pending answer to poll. */
export function submitTurn(
  fetchImpl: typeof fetch,
  conversationId: string,
  content: string,
  idempotencyKey: string,
): Promise<ApiOutcome<MagnusSubmittedTurn>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/turns`,
    { method: "POST", body: { content }, idempotencyKey },
  );
}

/** The poll: one turn's state, until it settles. */
export function readTurn(
  fetchImpl: typeof fetch,
  conversationId: string,
  turnId: string,
): Promise<ApiOutcome<MagnusTurnProgress>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}`,
  );
}

/** Renames a conversation. A null title returns it to displaying by its start instant. */
export function renameConversation(
  fetchImpl: typeof fetch,
  conversationId: string,
  title: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}`,
    { method: "PATCH", body: { title }, idempotencyKey },
  );
}

/**
 * Deletes a conversation and every turn in it. This is the erasure instrument for everything typed
 * into the assistant: the text goes wholesale, and what remains on the record is that a
 * conversation existed and was deleted.
 */
export function deleteConversation(
  fetchImpl: typeof fetch,
  conversationId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}`,
    { method: "DELETE", idempotencyKey },
  );
}

/** Records that this member has been shown, and accepted, the disclosure in force. */
export function acknowledgeDisclosure(
  fetchImpl: typeof fetch,
  idempotencyKey: string,
): Promise<ApiOutcome<MagnusAcknowledgement>> {
  return requestJson(fetchImpl, "/api/v1/magnus/acknowledgement", {
    method: "POST",
    idempotencyKey,
  });
}

/** A fresh idempotency key per submitted write, so a retry of THAT write is the same write. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}

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

/** A model that can answer: the firm's own, or another a member may choose in the composer. */
export interface MagnusAnsweringModel {
  modelId: string;
  /** The name the composer shows, such as "Claude Opus 5.5". */
  displayName: string;
  snapshotId: string;
  zeroDataRetention: boolean;
  /** The effort levels the model takes, lowest first; empty where it takes none. */
  effortLevels: string[];
  /** The effort it answers at when none is chosen; null where it takes none. */
  defaultEffort: string | null;
}

/** The model and effort a member chose in the composer for their next question. */
export interface MagnusModelChoice {
  modelId: string;
  effort: string | null;
}

export interface MagnusAvailability {
  state: MagnusAvailabilityState;
  /** The disclosure in force. Present when the member is being asked to accept it. */
  disclosureVersion?: number;
  /** What is left of the firm's daily allowance. Absent where the server did not say. */
  remainingDailyTurns?: number;
  /**
   * Which model answers. Present when open; null when the firm's stored model is one the platform
   * no longer carries, which the composer states rather than naming a model that will not answer.
   */
  model?: MagnusAnsweringModel | null;
  /** Present when open: every model a member may choose, the firm's own among them. */
  models?: MagnusAnsweringModel[];
}

/**
 * How a conversation listing is ordered: newest first (the default), by the member's own title, or
 * grouped by the matter each is kept on. Honoured by the server over the whole record, so the rail
 * never orders the page it happens to hold and calls that the order.
 */
export const CONVERSATION_SORTS = ["date", "name", "matter"] as const;
export type ConversationSort = (typeof CONVERSATION_SORTS)[number];

/** What became of an attached file's text on the most recent question that carried it. */
export type AttachmentTextStatus = "pending" | "sent" | "cut" | "unreadable";

/**
 * A matter's file attached to a conversation by reference. `name` is null where the file has been
 * deleted since; that is stated rather than hidden, because the member may remember attaching it.
 */
export interface MagnusAttachment {
  fileId: string;
  name: string | null;
  matterId: string | null;
  attachedAt: string;
  textStatus: AttachmentTextStatus;
  /** How many bytes of the file's text reached the model on the most recent question. */
  textBytes: number | null;
}

/**
 * Below this many turns left, the allowance is worth putting on screen.
 *
 * A firm's default allowance is in the hundreds, so printing "497 left today" on every visit is a
 * standing number nobody reads. The fact matters when it is about to bind, which is why the
 * threshold lives here as one value rather than as a number typed into a sentence.
 */
export const ALLOWANCE_WORTH_SAYING_AT = 25;

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
  /**
   * Which of the READER's folders it sits in; null is General. Where a member keeps a conversation
   * is theirs alone: it decides nothing about who may read it, and nobody else sees it.
   */
  folderId: string | null;
  /** When the reader pinned it; null when they have not. */
  pinnedAt: string | null;
}

/** One of the member's own folders. General is not one: it is where a conversation in no folder sits. */
export interface MagnusFolder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Where the reader keeps one conversation, as the server recorded it. */
export interface MagnusShelf {
  conversationId: string;
  folderId: string | null;
  pinnedAt: string | null;
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
  /** The effort the answer was asked for, or null where none was sent. */
  effort: string | null;
  /** A readable summary of Magnus's thinking on an answer, or null where there is none. */
  thinking: string | null;
  /**
   * When the author removed this message and its answer. The text is kept on the record but not
   * returned to the author, so a removed turn reads as a marker.
   */
  removedAt: string | null;
  /** When an edit of an earlier message set this turn aside; it remains as the earlier version. */
  supersededAt: string | null;
  /** On a message made by an edit, the message it replaces. */
  replacesTurnId: string | null;
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
  /** The summary of Magnus's thinking so far, once the model has returned some. */
  thinking?: string;
}

export interface MagnusConversationDetail {
  conversation: MagnusConversation;
  turns: Page<MagnusTurn>;
  attachments: MagnusAttachment[];
  /** What Magnus may read beyond the conversation, as its author set it. Every one starts off. */
  permissions: MagnusConversationPermission[];
}

/**
 * A read permission the conversation's author can turn on for that one conversation.
 * `own-matter-conversations`: the author's own other conversations kept on the same matter.
 */
export type MagnusConversationPermission = "own-matter-conversations";

/** One version of a document Magnus wrote, without its text. */
export interface MagnusArtifactVersion {
  versionNumber: number;
  /** What changed, as Magnus or the restore described it. */
  note: string | null;
  /** The answer that wrote it; null for a version a member restored. */
  writtenByTurnId: string | null;
  memberUserId: string;
  restoredFromVersion: number | null;
  createdAt: string;
  bytes: number;
}

/** A document Magnus wrote in a conversation, with its versions oldest first. */
export interface MagnusArtifact {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  versions: MagnusArtifactVersion[];
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
  /**
   * Narrows to the conversations a term reaches — the title, and what was said in them. The server
   * searches the whole record rather than the page in hand, which is why this is a filter on the
   * read and not something the rail does to the rows it already holds.
   */
  search?: string;
  /** The order the record is read in. Absent means newest first. */
  sort?: ConversationSort;
  /** One of the reader's folders by its id, or "general" for the conversations in none. */
  folder?: string;
  /** Only what the reader has pinned. */
  pinned?: boolean;
}

function conversationQuery(filters: ConversationListFilters, cursor?: string): string {
  const query = new URLSearchParams();
  if (cursor !== undefined) query.set("cursor", cursor);
  if (filters.matterId !== undefined) query.set("matterId", filters.matterId);
  // A blank term is not a search. Sending one would ask the server to match every row against "%%",
  // which is the whole record at a cost, for an answer identical to asking nothing.
  if (filters.search !== undefined && filters.search.trim() !== "") {
    query.set("search", filters.search.trim());
  }
  if (filters.sort !== undefined && filters.sort !== "date") query.set("sort", filters.sort);
  if (filters.folder !== undefined) query.set("folder", filters.folder);
  if (filters.pinned === true) query.set("pinned", "true");
  return query.size === 0 ? "" : `?${query.toString()}`;
}

/**
 * The caller's own conversations, in the order asked for (newest first by default). With a matter
 * filter, only the ones kept on that matter's file, which is what a matter's own assistant section
 * reads; with a search, only the ones whose title or transcript the term reaches.
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
  choice: MagnusModelChoice | null = null,
): Promise<ApiOutcome<MagnusSubmittedTurn>> {
  // No choice sends no model, and the firm's model answers at its own default effort.
  const body =
    choice === null
      ? { content }
      : {
          content,
          modelId: choice.modelId,
          ...(choice.effort !== null && { effort: choice.effort }),
        };
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/turns`,
    { method: "POST", body, idempotencyKey },
  );
}

/**
 * Edits one of the member's messages and asks again from there. The message and every turn after
 * it are set aside (kept on the record), and the edit comes back as a new message with a pending
 * answer, exactly as a new question does.
 */
export function editTurn(
  fetchImpl: typeof fetch,
  conversationId: string,
  turnId: string,
  content: string,
  idempotencyKey: string,
  choice: MagnusModelChoice | null = null,
): Promise<ApiOutcome<MagnusSubmittedTurn>> {
  const body =
    choice === null
      ? { content }
      : {
          content,
          modelId: choice.modelId,
          ...(choice.effort !== null && { effort: choice.effort }),
        };
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}`,
    { method: "PATCH", body, idempotencyKey },
  );
}

/** Removes one of the member's messages and its answer from the conversation, behind a marker. */
export function removeTurn(
  fetchImpl: typeof fetch,
  conversationId: string,
  turnId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ memberTurnId: string; magnusTurnId: string | null; removedAt: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}`,
    { method: "DELETE", idempotencyKey },
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
 * Keeps a conversation on another matter's file, or on none. Which matter a transcript is kept on
 * is what decides who may read it, so the dialog that calls this says so before the press. The
 * conversation's attachments go with the move, because each is one of the old matter's files.
 */
export function moveConversation(
  fetchImpl: typeof fetch,
  conversationId: string,
  matterId: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<MagnusConversation>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/matter`,
    { method: "PATCH", body: { matterId }, idempotencyKey },
  );
}

/**
 * Attaches one of the conversation's matter's files, by reference. Nothing is copied: on each later
 * question the file's readable text is read fresh and sent ahead of the question, within a budget.
 */
export function attachFile(
  fetchImpl: typeof fetch,
  conversationId: string,
  fileId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<MagnusAttachment[]>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/attachments`,
    { method: "POST", body: { fileId }, idempotencyKey },
  );
}

/** Takes a file off the conversation. Nothing was copied, so nothing is erased. */
export function detachFile(
  fetchImpl: typeof fetch,
  conversationId: string,
  fileId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<MagnusAttachment[]>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(fileId)}`,
    { method: "DELETE", idempotencyKey },
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

/** The member's own folders, by name. */
export function listFolders(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: MagnusFolder[] }>> {
  return requestJson(fetchImpl, "/api/v1/magnus/folders");
}

export function createFolder(
  fetchImpl: typeof fetch,
  name: string,
  idempotencyKey: string,
): Promise<ApiOutcome<MagnusFolder>> {
  return requestJson(fetchImpl, "/api/v1/magnus/folders", {
    method: "POST",
    body: { name },
    idempotencyKey,
  });
}

export function renameFolder(
  fetchImpl: typeof fetch,
  folderId: string,
  name: string,
  idempotencyKey: string,
): Promise<ApiOutcome<MagnusFolder>> {
  return requestJson(fetchImpl, `/api/v1/magnus/folders/${encodeURIComponent(folderId)}`, {
    method: "PATCH",
    body: { name },
    idempotencyKey,
  });
}

/** Removes a folder. What was in it goes back to General; no conversation is removed. */
export function deleteFolder(
  fetchImpl: typeof fetch,
  folderId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/magnus/folders/${encodeURIComponent(folderId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/**
 * Says where the reader keeps one conversation: a folder (null is General) and whether it is
 * pinned. Both halves at once, so a move and a pin are never half applied.
 */
export function shelveConversation(
  fetchImpl: typeof fetch,
  conversationId: string,
  shelf: { folderId: string | null; pinned: boolean },
  idempotencyKey: string,
): Promise<ApiOutcome<MagnusShelf>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/shelf`,
    { method: "PUT", body: shelf, idempotencyKey },
  );
}

/** Turns one of Magnus's read permissions on or off for one of the caller's conversations. */
export function setConversationPermission(
  fetchImpl: typeof fetch,
  conversationId: string,
  permission: MagnusConversationPermission,
  granted: boolean,
  idempotencyKey: string,
): Promise<ApiOutcome<{ permissions: MagnusConversationPermission[] }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/permissions/${encodeURIComponent(permission)}`,
    { method: "PUT", body: { granted }, idempotencyKey },
  );
}

/** The documents Magnus wrote in a conversation, each with its versions but not their text. */
export function listArtifacts(
  fetchImpl: typeof fetch,
  conversationId: string,
): Promise<ApiOutcome<{ artifacts: MagnusArtifact[] }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/artifacts`,
  );
}

/** The text of one version of a document. */
export function readArtifactVersion(
  fetchImpl: typeof fetch,
  conversationId: string,
  artifactId: string,
  versionNumber: number,
): Promise<ApiOutcome<{ artifactId: string; versionNumber: number; content: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/artifacts/${encodeURIComponent(artifactId)}/versions/${versionNumber}`,
  );
}

/** Puts an earlier version back as the newest. Every version stays. */
export function restoreArtifactVersion(
  fetchImpl: typeof fetch,
  conversationId: string,
  artifactId: string,
  versionNumber: number,
  idempotencyKey: string,
): Promise<ApiOutcome<MagnusArtifact>> {
  return requestJson(
    fetchImpl,
    `/api/v1/magnus/conversations/${encodeURIComponent(conversationId)}/artifacts/${encodeURIComponent(artifactId)}/restore`,
    { method: "POST", body: { versionNumber }, idempotencyKey },
  );
}

/** A fresh idempotency key per submitted write, so a retry of THAT write is the same write. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}

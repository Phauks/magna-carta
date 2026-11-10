/*
 * The call and text log's reads and writes — what the firm said down a phone line, on every channel
 * that is not email.
 *
 * Mirrors the `communications.*` operations in apps/api-worker/openapi/openapi.json. `apps/web`
 * hand-writes the response shapes it reads (the transport seam in $lib/api/request.ts says why), so
 * each type here is the wire shape and nothing more — the surfaces do the presenting.
 *
 * TWO READS OF ONE RECORD, AND THE DIFFERENCE IS THE WHOLE DESIGN. The firm-wide list holds the
 * unassigned and the cross-matter; a matter's own list holds the assigned and the case-bound. Filing
 * a row onto a matter is what moves it from the first to the second, and that act exists only on the
 * firm-wide surface — inside a matter the matter is already known, so there is nothing to decide.
 *
 * IT NEVER RESOLVES A NAME. A counterparty entity and a member are handles, and this module has no
 * business duplicating the Directory's display rules — the same line the custody register holds.
 *
 * EVERY WRITE CARRIES AN IDEMPOTENCY KEY, and the contract refuses it without one. A person who
 * presses submit twice, or whose first attempt died on a dropped connection, must not put two
 * identical accounts of one phone call on the matter — which read as two calls, and are exactly the
 * wrong thing for a record whose whole value is saying what happened.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

/** The permission a reader needs. A member without it is refused server-side. */
export const READ_COMMUNICATIONS_PERMISSION = "communications:read";

/** The permission that logs a call or a message, files one onto a matter, or takes one off. */
export const LOG_COMMUNICATIONS_PERMISSION = "communications:log";

/**
 * The permission that reveals the queue of calls and texts belonging to no matter yet.
 *
 * Separate from the read on purpose. Every routed row is narrowed to the matters a member may see,
 * so a walled matter contributes nothing to the firm-wide read; an unrouted row has no matter, so
 * that narrowing has nothing to bite on. What sits in that queue is whatever was said to the firm's
 * number before anybody decided where it belonged.
 */
export const REVIEW_UNROUTED_PERMISSION = "communications:reviewUnrouted";

export type CommunicationChannel = "voice" | "sms" | "mms";
export type CommunicationDirection = "inbound" | "outbound";
export type CommunicationProducer = "member" | "carrier";
export type CommunicationScope = "all" | "routed" | "unrouted" | "setAside";

/**
 * Why a call or a text belongs to no matter.
 *
 * The alternative to a matter, and the reason the queue can be emptied at all: not every call a firm
 * takes is about a case. Some are spam or a wrong number, some are the firm's own business, and some
 * are a real prospect nothing ever came of. None of them can be filed, because there is no matter.
 */
export type CommunicationDisposition = "spam" | "firmBusiness" | "noAction";

/** The channels a PERSON chooses between. A picture is a text that carries one, not a third kind. */
export const LOGGABLE_CHANNELS: readonly CommunicationChannel[] = ["voice", "sms"];

export function isCommunicationChannel(value: string): value is CommunicationChannel {
  return value === "voice" || value === "sms" || value === "mms";
}

/** One call or message as the log answers it. */
export interface Communication {
  id: string;
  /**
   * The number the firm says out loud — the day and that day's own sequence, `2026-09-08-0042`.
   *
   * Null only on rows recorded before the sequence existed and never numbered. A surface renders the
   * handle nowhere, so a null here reads as "no number" rather than falling back to one.
   */
  referenceNumber: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  /** Null while the row is in the queue, waiting for somebody to file it. */
  matterId: string | null;
  matterTitle: string | null;
  /**
   * The anchor's status, and it is not decoration. An anchor may be an intake or a consultation,
   * which carry no matter number, and what may be said to a prospect and to a client are different
   * things — so somebody about to reply has to be able to see which they are talking to.
   */
  matterStatus: string | null;
  /** Null on exactly the unnumbered anchors; the consultation's own number stands in its place. */
  matterNumber: string | null;
  consultationNumber: string | null;
  intakeNumber: string | null;
  /** Why it belongs to no matter, where somebody said so. Null on a filed row and on an undecided one. */
  disposition: CommunicationDisposition | null;
  counterpartyNumber: string;
  counterpartyEntityId: string | null;
  memberUserId: string | null;
  occurredAt: string;
  /**
   * When the line closed, which is not how long the call ran. A caller left on hold occupies the
   * span without spending it, so the two are separate facts and neither is worked out from the
   * other. Null on a text, and on a call whose end nobody recorded.
   */
  endedAt: string | null;
  durationSeconds: number | null;
  body: string | null;
  summary: string | null;
  /**
   * How the row came to exist. Only `member` is written today; `carrier` arrives with the Telnyx
   * adapter and writes the same row. A surface that cannot tell them apart will present a
   * recollection as an observation.
   */
  producer: CommunicationProducer;
  loggedByUserId: string | null;
  /** The name the caller gave, as typed. Never a Directory record; counterpartyEntityId is that. */
  callerIdName: string | null;
  /** What happened on the line, and which kind of spam where it was spam. */
  outcome: CallOutcome | null;
  spamKind: SpamKind | null;
  /** The task a message taken on this call became. The message is open while that task is. */
  messageTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What can happen on a call, by direction (owner ruling, 2026-11-09: Activity, in formal words, with
 * spam among them). The server holds the same two lists and refuses an outcome from the wrong one.
 */
export const INBOUND_CALL_OUTCOMES = ["answered", "transferred", "messageTaken", "spam"] as const;
export const OUTBOUND_CALL_OUTCOMES = ["connected", "voicemailLeft", "noAnswer"] as const;
export type CallOutcome =
  | (typeof INBOUND_CALL_OUTCOMES)[number]
  | (typeof OUTBOUND_CALL_OUTCOMES)[number];

/** Which kind of unwanted call it was. */
export const SPAM_KINDS = ["sales", "wrongNumber", "scam"] as const;
export type SpamKind = (typeof SPAM_KINDS)[number];

/** A message taken on a call, for one member. It becomes a task in their list. */
export interface CallMessageInput {
  forUserId: string;
  title: string;
  dueOn?: string | null;
  timeZone?: string | null;
  urgent?: boolean;
}

/**
 * The two facts an intake needs from the call that started it: which row to file onto the matter it
 * opens, and who to seed as the client.
 *
 * Narrower than a whole record on purpose. A call being recorded hands these up the moment its write
 * lands, without waiting on a read-back it does not need — and a surface that opens an intake should
 * not be able to reach into the rest of a call's content on the way.
 */
export interface IntakeSource {
  readonly id: string;
  readonly counterpartyEntityId: string | null;
}

/** What the log may be narrowed by. Every one of these is the server's own filter. */
export interface CommunicationQuery {
  scope?: CommunicationScope;
  channel?: CommunicationChannel;
  /** Matched against what was said AND against the number, which is how people look for a text. */
  search?: string;
  matterId?: string;
  cursor?: string;
}

function query(parameters: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const rendered = search.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

/**
 * One page of the log, newest first.
 *
 * Naming a matter reads that matter's own section; leaving it off reads the firm's. They are the
 * same rows through the same gate — a section written as its own read would drift from the log it is
 * a view of, and the drift would be silent.
 */
export function listCommunications(
  fetchImpl: typeof fetch,
  parameters: CommunicationQuery = {},
): Promise<ApiOutcome<Page<Communication>>> {
  const suffix = query({
    scope: parameters.scope,
    channel: parameters.channel,
    search: parameters.search,
    cursor: parameters.cursor,
  });
  return parameters.matterId === undefined
    ? requestJson(fetchImpl, `/api/v1/communications${suffix}`)
    : requestJson(
        fetchImpl,
        `/api/v1/matters/${encodeURIComponent(parameters.matterId)}/communications${suffix}`,
      );
}

/**
 * The number the next call or text recorded for that day would carry.
 *
 * A PREVIEW AND NOT A RESERVATION. Somebody still on the telephone needs something to write on the
 * slip and read back to the caller, and waiting for the save to answer is too late for the sentence
 * they are in the middle of — so the form asks what the number would be. Nothing is drawn by asking,
 * so a call recorded first takes it and this one moves on; the record's own number is always read
 * back from the record.
 */
export function readNextCommunicationNumber(
  fetchImpl: typeof fetch,
  occurredAt: string,
): Promise<ApiOutcome<{ referenceNumber: string }>> {
  const suffix = occurredAt === "" ? "" : `?occurredAt=${encodeURIComponent(occurredAt)}`;
  return requestJson(fetchImpl, `/api/v1/communications/next-number${suffix}`);
}

/** How many calls and texts are waiting to be filed. Refused without the review capability. */
export function readUnroutedCount(fetchImpl: typeof fetch): Promise<ApiOutcome<{ count: number }>> {
  return requestJson(fetchImpl, "/api/v1/communications/unrouted-count");
}

export interface LogCommunicationInput {
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  /**
   * Optional, and an UNNUMBERED matter counts: a matter number is null until a matter opens, and an
   * intake or a consultation is a real anchor a first contact usually lands on. Omitted, the row
   * lands in the queue for somebody to file.
   */
  matterId?: string | null;
  counterpartyNumber: string;
  counterpartyEntityId?: string | null;
  memberUserId?: string | null;
  occurredAt: string;
  endedAt?: string | null;
  durationSeconds?: number | null;
  body?: string | null;
  summary?: string | null;
  /** Set aside as it is recorded. Refused together with a matter — a row has one anchor, never two. */
  disposition?: CommunicationDisposition | null;
  callerIdName?: string | null;
  /** A spam outcome sets the spam disposition itself; a transfer names its member in memberUserId. */
  outcome?: CallOutcome | null;
  spamKind?: SpamKind | null;
  message?: CallMessageInput | null;
}

export function logCommunication(
  fetchImpl: typeof fetch,
  input: LogCommunicationInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/communications", {
    method: "POST",
    body: input,
    idempotencyKey,
  });
}

/** Files a call or a message onto a matter, taking it out of the queue. */
export function fileCommunicationToMatter(
  fetchImpl: typeof fetch,
  communicationId: string,
  matterId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/communications/${encodeURIComponent(communicationId)}/matter`,
    { method: "POST", body: { matterId }, idempotencyKey },
  );
}

/**
 * Takes a call or a message off the matter it was filed to. The row returns to the queue rather than
 * being deleted: what was said still happened, and a message taken off the wrong matter has to land
 * somewhere a person will see it again.
 */
export function unfileCommunicationFromMatter(
  fetchImpl: typeof fetch,
  communicationId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/communications/${encodeURIComponent(communicationId)}/matter`,
    { method: "DELETE", idempotencyKey },
  );
}

/** A fresh idempotency key per submitted write, so a retry of THAT write is the same write. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}

/** One call or message by its id — what the record window reads when it is opened from a row. */
export function readCommunication(
  fetchImpl: typeof fetch,
  communicationId: string,
): Promise<ApiOutcome<Communication>> {
  return requestJson(fetchImpl, `/api/v1/communications/${encodeURIComponent(communicationId)}`);
}

/**
 * What a correction may change. Every field optional, and an omitted one keeps what the record
 * holds — the matter and the set-aside reason are absent on purpose, because each moves the row
 * between queues through its own act.
 */
export interface UpdateCommunicationInput {
  channel?: CommunicationChannel;
  direction?: CommunicationDirection;
  counterpartyNumber?: string;
  counterpartyEntityId?: string | null;
  memberUserId?: string | null;
  occurredAt?: string;
  endedAt?: string | null;
  durationSeconds?: number | null;
  body?: string | null;
  summary?: string | null;
}

/** Corrects a record somebody typed. A carrier-written one is refused by the server. */
export function updateCommunication(
  fetchImpl: typeof fetch,
  communicationId: string,
  input: UpdateCommunicationInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/communications/${encodeURIComponent(communicationId)}`, {
    method: "PATCH",
    body: input,
    idempotencyKey,
  });
}

/**
 * Sets a call or a message aside as something that belongs to no matter.
 *
 * It leaves the queue without being filed and without being deleted: what was said still happened,
 * and a firm that later decides a written-off call was real work puts it back with the call below.
 */
export function setCommunicationDisposition(
  fetchImpl: typeof fetch,
  communicationId: string,
  disposition: CommunicationDisposition,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/communications/${encodeURIComponent(communicationId)}/disposition`,
    { method: "POST", body: { disposition }, idempotencyKey },
  );
}

/** Returns a set-aside call or message to the queue. */
export function clearCommunicationDisposition(
  fetchImpl: typeof fetch,
  communicationId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/communications/${encodeURIComponent(communicationId)}/disposition`,
    { method: "DELETE", idempotencyKey },
  );
}

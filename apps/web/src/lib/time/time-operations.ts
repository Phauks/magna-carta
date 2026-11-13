/*
 * What a person can actually do to a time entry, and what the server will actually accept.
 *
 * The design gives the ledger a fuller verb set than the contract serves: unsubmit, delete-draft,
 * record one member's work under another's. None of those has a route, so none of them is called
 * from here — the surfaces render them where they belong, refused, and
 * say what each waits on. What IS here is exactly the set the contract serves, so the difference
 * between "designed" and "working" is a difference a reader of this file can see.
 *
 * KEEPING THAT LIST HONEST IS THE WHOLE POINT OF IT. Attaching a file, writing the internal memo
 * and reading an entry's history were all on it while the routes for all three were already
 * shipping, so three surfaces went on saying "not built yet" about work that was done. A verb
 * leaves this list when its route lands, not when somebody notices.
 *
 * EVERY WRITE TAKES AN IDEMPOTENCY KEY, BECAUSE THE CONTRACT REQUIRES ONE ON EVERY WRITE. Not just
 * on capture: update, submit, approve, kick-back and void all declare it required, and the header
 * requirement is enforced ahead of the handler, so a call without a key is refused with a 400
 * before anything looks at the body. Making the key a REQUIRED PARAMETER of each function is what
 * keeps that from being a thing a caller can forget — an omission becomes a type error at the call
 * site rather than a failed save the reader discovers by typing.
 *
 * Every call goes through the one transport seam, so a dead network is an outcome rather than a
 * thrown error, and the surface can say something true about it.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
import type { TimeEntryStatus, TimeEntrySummary } from "$lib/matters/time-api.ts";

/**
 * Every entry the firm holds, newest first, in every status.
 *
 * The Time Sheet opens from the top bar over whatever a person was doing, so what it reads is the
 * firm's time and not one matter's: `matterId` is optional on the listing, and omitting it is what
 * makes the surface firm-wide rather than a per-matter surface with a wider title. A sheet opened
 * FROM a matter passes the matter and gets the same shape back, so one surface serves both doors.
 *
 * The status is deliberately not passed, on the same rule the per-matter read follows: a record is
 * all of it, and narrowing to one status is a different question asked by a different caller.
 */
export function listTimeEntries(
  fetchImpl: typeof fetch,
  query: { readonly matterId?: string | null; readonly cursor?: string } = {},
): Promise<ApiOutcome<Page<TimeEntrySummary>>> {
  const parameters = new URLSearchParams();
  if (query.matterId !== undefined && query.matterId !== null) {
    parameters.set("matterId", query.matterId);
  }
  if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
  const suffix = parameters.toString();
  return requestJson(fetchImpl, `/api/v1/time-entries${suffix === "" ? "" : `?${suffix}`}`);
}

/** Whose time a period listing is asking for, and how far it reaches. */
export interface TimePeriodQuery {
  /** The first work date, inclusive. Absent, the listing runs from the first entry ever recorded. */
  readonly from?: string;
  /** The last work date, inclusive. Absent, the listing runs to the present. */
  readonly to?: string;
  /**
   * One timekeeper's own record, or null for the whole firm's.
   *
   * Null is a deliberate value rather than an omission: asking for everybody is a real question and
   * the server gates it on `time:viewFirm`, so a surface without the capability must ask for a
   * person by name rather than leaving the field off and hoping to be defaulted to itself.
   */
  readonly timekeeperUserId: string | null;
  /** The statuses the screen's Status column holds; empty or absent is every status. */
  readonly statuses?: readonly TimeEntryStatus[];
  /** The screen's search: the narrative, the entry number, the matter's title and number, the timekeeper. */
  readonly search?: string;
  readonly cursor?: string;
}

/**
 * Every entry across every matter, newest work date first, bounded by whatever the query names.
 *
 * This is the read the firm's Time screen is built on. The day listing answers what one person
 * did on one date and the matter listing answers what is on one file; neither answers "what time
 * was recorded this week", which is the question a timekeeper asks of their own record and a
 * supervisor asks of the firm's.
 *
 * THE BOUNDS AND THE STATUS ARE THE SCREEN'S COLUMN FILTERS, sent here so they hold across every
 * page: a filter that narrowed only the loaded page would tell a reader there are three drafts in
 * a month that holds thirty. Nothing named is the whole record.
 */
export function listTimeEntriesInPeriod(
  fetchImpl: typeof fetch,
  query: TimePeriodQuery,
): Promise<ApiOutcome<Page<TimeEntrySummary>>> {
  const parameters = new URLSearchParams();
  if (query.from !== undefined) parameters.set("from", query.from);
  if (query.to !== undefined) parameters.set("to", query.to);
  if (query.timekeeperUserId !== null) {
    parameters.set("timekeeperUserId", query.timekeeperUserId);
  }
  for (const status of query.statuses ?? []) parameters.append("status", status);
  if (query.search !== undefined && query.search.trim() !== "") {
    parameters.set("search", query.search.trim());
  }
  if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
  const suffix = parameters.toString();
  return requestJson(fetchImpl, `/api/v1/time-entries${suffix === "" ? "" : `?${suffix}`}`);
}

/** What the create route answers: the identity of the entry it wrote. */
export interface TimeEntryAcknowledgement {
  timeEntryId: string;
}

/** The facts a new draft is written from. Everything else about it is the server's to decide. */
export interface DraftTimeEntry {
  readonly matterId: string;
  readonly timekeeperUserId: string;
  readonly workDate: string;
  readonly rawDurationMinutes: number;
  readonly narrative: string;
  readonly billable: boolean;
  readonly utbmsTaskCodeId?: string | null;
  readonly utbmsActivityCodeId?: string | null;
  readonly memo?: string | null;
  /** A rate for this entry alone, in ten-thousandths of a currency unit. */
  readonly overrideRateE4?: number | null;
  /**
   * The task this time was worked on, where the timekeeper named one. Omitted on nearly every
   * entry: time is captured against a MATTER, and naming a task is an extra. The server refuses a
   * task on another matter, so the picker only ever offers this matter's own.
   */
  readonly taskId?: string | null;
}

/**
 * Record a draft. The contract requires an idempotency key on the write, because a retried save
 * must not put a second entry on the matter's ledger.
 */
export function createTimeEntry(
  fetchImpl: typeof fetch,
  draft: DraftTimeEntry,
  idempotencyKey: string,
): Promise<ApiOutcome<TimeEntryAcknowledgement>> {
  return requestJson(fetchImpl, "/api/v1/time-entries", {
    method: "POST",
    body: { ...draft, source: "manual" },
    idempotencyKey,
  });
}

/**
 * The fields a new draft can be STARTED from, as opposed to written from.
 *
 * Duplicating an entry hands these over: they are the facts the listing actually carries, so they
 * are the facts a copy can hold. Whatever else the record is designed to carry — category, activity
 * code, resolved rate — is not served, so a duplicate cannot bring it and does not pretend to.
 */
export interface TimeEntryDraftFields {
  readonly narrative: string;
  readonly workDate: string;
  readonly rawDurationMinutes: number;
  readonly billable: boolean;
  readonly timekeeperUserId: string;
}

/** The parts of an entry the update route accepts. */
export interface TimeEntryChanges {
  readonly narrative?: string;
  readonly rawDurationMinutes?: number;
  readonly workDate?: string;
  /** The UTBMS task code — the entry's category. Null clears it; absent leaves it alone. */
  readonly utbmsTaskCodeId?: string | null;
  readonly utbmsActivityCodeId?: string | null;
  /** The firm's internal note. Null clears it; absent leaves it alone. */
  readonly memo?: string | null;
  /**
   * A rate for THIS entry, in ten-thousandths of a currency unit, above every tier of the chain.
   * Null clears it and the chain answers again; absent leaves the entry's rate exactly as it is.
   */
  readonly overrideRateE4?: number | null;
  /** Null unlinks the task; absent leaves it alone. Refused on a billed or void entry. */
  readonly taskId?: string | null;
}

export function patchTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  changes: TimeEntryChanges,
  idempotencyKey: string,
): Promise<ApiOutcome<TimeEntrySummary>> {
  return requestJson(fetchImpl, `/api/v1/time-entries/${encodeURIComponent(timeEntryId)}`, {
    method: "PATCH",
    body: changes,
    idempotencyKey,
  });
}

/**
 * One chain verb against one entry.
 *
 * The five transitions differ only in the word at the end of the path and whether they carry a
 * body, so they are one call with the word passed in — which also means the idempotency key cannot
 * be threaded through four of them and dropped from the fifth.
 */
function transition(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  action: string,
  idempotencyKey: string,
  body?: unknown,
): Promise<ApiOutcome<unknown>> {
  return requestJson(
    fetchImpl,
    `/api/v1/time-entries/${encodeURIComponent(timeEntryId)}/${action}`,
    {
      method: "POST",
      idempotencyKey,
      ...(body === undefined ? {} : { body }),
    },
  );
}

export function submitTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<unknown>> {
  return transition(fetchImpl, timeEntryId, "submit", idempotencyKey);
}

export function approveTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<unknown>> {
  return transition(fetchImpl, timeEntryId, "approve", idempotencyKey);
}

/**
 * Return an entry to its timekeeper as a draft.
 *
 * The design settled that the reason is optional and recorded only when given; the route requires
 * one, so the surface asks for it and this call cannot pretend otherwise. The difference is
 * recorded rather than papered over with a stand-in sentence nobody wrote.
 */
export function kickBackTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<unknown>> {
  return transition(fetchImpl, timeEntryId, "kick-back", idempotencyKey, { reason });
}

/**
 * Move a misfiled draft onto the matter it belongs to.
 *
 * Its own route rather than a field on the update, because it is a cross-matter write: two ledgers
 * change, and the rate the entry froze was resolved against the matter it is leaving. What the
 * caller gets back is what the entry now carries — the rate and the rounding are re-asked against
 * the destination on the entry's own work date, so a screen that assumed nothing moved but the
 * matter would be showing the wrong money until its next read.
 *
 * The entry number does NOT change. A reference that changes is a reference that lies, so anything
 * that cited it keeps resolving; the consequence is that a moved entry's number names the matter it
 * was FIRST written on, which is provenance rather than an assertion about where it lives now.
 */
export interface RefiledTimeEntry {
  timeEntryId: string;
  matterId: string;
  durationMinutes: number;
  rateE4: number | null;
  amountMinor: number | null;
  currency: string;
}

export function refileTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  matterId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<RefiledTimeEntry>> {
  return requestJson(fetchImpl, `/api/v1/time-entries/${encodeURIComponent(timeEntryId)}/refile`, {
    method: "POST",
    body: { matterId },
    idempotencyKey,
  });
}

/** Void an entry. It stays on the ledger, carries no value, and is not removed. */
export function voidTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<unknown>> {
  return transition(fetchImpl, timeEntryId, "void", idempotencyKey);
}

/**
 * Undo a void, putting the entry back to draft with everything it carries.
 *
 * The repair for a void nobody meant, and the reason it is worth a route: re-typing the entry loses
 * its number, its memo, its codes, its attached documents and its history. Refused (409) for an
 * entry that was never voided, and for one whose value became a cost entry — restoring that one
 * would charge the same work twice.
 */
export function unvoidTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<unknown>> {
  return transition(fetchImpl, timeEntryId, "unvoid", idempotencyKey);
}

/*
 * ---------------------------------------------------------------------------------------------
 * What an entry carries BESIDE its own row: its history, its attached files, and the catalogues a
 * reader picks its codes from. Each is its own read, made by the surface that shows it and not
 * before — an entry's history is a page nobody looks at until they open the record.
 */

/** One recorded event on an entry, as the history rail reads it. */
export interface TimeEntryEvent {
  at: string;
  /** The audit event's own name, e.g. "time_entry.captured". */
  event: string;
  actorUserId: string | null;
  /** Resolved through the member mirror; null for system events and departed members. */
  actorName: string | null;
  /** Whatever redacted detail the write recorded. Null where it recorded none. */
  detail: unknown;
}

/**
 * The entry's recorded events, oldest first — the order a history rail reads in.
 *
 * Cursor-paged, because an entry worked over a week records an event per edit: the history grows
 * with the work rather than with the lifecycle.
 */
export function listTimeEntryEvents(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<TimeEntryEvent>>> {
  const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
  return requestJson(
    fetchImpl,
    `/api/v1/time-entries/${encodeURIComponent(timeEntryId)}/events${query}`,
  );
}

/** One document an entry points at. */
export interface TimeEntryAttachment {
  fileId: string;
  /** The file's CURRENT name, resolved at read time; null where the file row is gone. */
  fileName: string | null;
  createdAt: string;
  createdByUserId: string | null;
  createdByName: string | null;
}

export function listTimeEntryAttachments(
  fetchImpl: typeof fetch,
  timeEntryId: string,
): Promise<ApiOutcome<{ data: TimeEntryAttachment[] }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/time-entries/${encodeURIComponent(timeEntryId)}/attachments`,
  );
}

/**
 * Point the entry at one of its matter's documents.
 *
 * It REFERENCES the file rather than copying it: the document stays where it is in the matter, and
 * detaching later removes the link and never the file. A file on another matter is refused, which
 * is the rule that keeps an entry's evidence inside the matter it was recorded against.
 */
export function attachTimeEntryFile(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  fileId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ timeEntryId: string; fileId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/time-entries/${encodeURIComponent(timeEntryId)}/attachments`,
    { method: "POST", body: { fileId }, idempotencyKey },
  );
}

/** Remove the link. The matter keeps the document. */
export function detachTimeEntryFile(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  fileId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ timeEntryId: string; fileId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/time-entries/${encodeURIComponent(timeEntryId)}/attachments/detach`,
    { method: "POST", body: { fileId }, idempotencyKey },
  );
}

/** One ABA code the firm's catalogue holds. */
export interface UtbmsCode {
  id: string;
  codeSet: string;
  code: string;
  label: string;
  practiceArea: string | null;
  /** Non-zero where the firm has this code turned on for entry and billing exports. */
  active: number;
}

/**
 * The firm's UTBMS codes for one ABA set.
 *
 * The listing is gated on the UTBMS management permission rather than a read permission, so an
 * account that may record time may still be refused this. The refusal is an outcome the caller
 * renders, never an empty catalogue: "the firm has no codes" and "you may not read them" are
 * different facts and they must not look alike.
 */
export function listUtbmsCodes(
  fetchImpl: typeof fetch,
  codeSet: "task" | "activity",
): Promise<ApiOutcome<{ data: UtbmsCode[] }>> {
  return requestJson(fetchImpl, `/api/v1/utbms-codes?codeSet=${codeSet}`);
}

/**
 * A fresh idempotency key for ONE attempt.
 *
 * Not for its retries, despite how a call site reads: this is called inside the attempt, so a retry
 * calls it again and gets a different key — which makes the retry a different request as far as the
 * server is concerned, and records the thing twice if the first attempt committed before its response
 * was lost. Where that matters, hold a `WriteIntent` (`$lib/api/write-intent.ts`) for the intent and
 * let it supply the key: it keeps one key across every attempt and rotates only after a success.
 */
export function writeKey(): string {
  return crypto.randomUUID();
}

/*
 * ---------------------------------------------------------------------------------------------
 * THE FIRM'S ROUNDING POLICY, and the three ways a duration can be typed.
 *
 * These belong together because two of the three depend on the policy. A billing UNIT is not a
 * universal quantity — it is whatever increment the firm bills at, a tenth of an hour in most
 * places and a quarter in some — so a screen that offers "units" and assumes six minutes records
 * the wrong amount of work for half its customers. And the BILLED figure is the worked one rounded
 * to that same increment, which is the other thing a capture screen has to be able to say.
 * ---------------------------------------------------------------------------------------------
 */

/** How this firm turns worked minutes into billed ones, for this matter and this person. */
export interface RoundingPolicy {
  /** The increment billed time is rounded to, in minutes. Also what one unit is worth. */
  readonly incrementMinutes: number;
  readonly roundingDirection: "up" | "nearest" | "down";
}

/**
 * Read the policy in force for a capture. Both scopes are optional: without them the answer is the
 * firm's own, which is the right answer for a screen that has not been pointed at a matter yet.
 */
export function readRoundingPolicy(
  fetchImpl: typeof fetch,
  scope: { matterId?: string | null; timekeeperUserId?: string | null } = {},
): Promise<ApiOutcome<RoundingPolicy>> {
  const query = new URLSearchParams();
  if (scope.matterId != null && scope.matterId !== "") query.set("matterId", scope.matterId);
  if (scope.timekeeperUserId != null && scope.timekeeperUserId !== "") {
    query.set("timekeeperUserId", scope.timekeeperUserId);
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return requestJson(fetchImpl, `/api/v1/time-entries/rounding-policy${suffix}`);
}

/** Worked minutes as the firm will bill them. Mirrors the server's own rounding, for display. */
export function roundToIncrement(minutes: number, policy: RoundingPolicy): number {
  const increment = policy.incrementMinutes;
  if (increment <= 0) return minutes;
  const quotient = minutes / increment;
  const units =
    policy.roundingDirection === "up"
      ? Math.ceil(quotient)
      : policy.roundingDirection === "down"
        ? Math.floor(quotient)
        : Math.round(quotient);
  return units * increment;
}

/**
 * A clock time somebody typed, as minutes past midnight. Accepts "9", "9:30", "0930", "9:30 pm",
 * "9pm" — the shapes people actually type into a start-and-end pair — and null for anything else.
 */
export function parseClockTime(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "") return null;
  const match = /^(\d{1,2})(?::?([0-5]\d))?\s*(am|pm)?$/.exec(trimmed);
  if (match === null) return null;
  const meridiem = match[3];
  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (meridiem === undefined) {
    if (hours > 23) return null;
  } else {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "am") hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  }
  return hours * 60 + minutes;
}

/**
 * How long somebody was at it, from the two clock times they were at it between.
 *
 * A span that ENDS EARLIER THAN IT STARTS is read as crossing midnight rather than refused: work
 * that begins at 23:00 and ends at 01:00 is two hours of it, and that is a night most people in
 * this product have had. A span of exactly zero is not a duration and answers null.
 */
export function parseTimeSpan(from: string, to: string): number | null {
  const start = parseClockTime(from);
  const end = parseClockTime(to);
  if (start === null || end === null) return null;
  const elapsed = end > start ? end - start : end === start ? 0 : end + 24 * 60 - start;
  return elapsed === 0 ? null : elapsed;
}

/**
 * Reading a duration somebody typed. Both literacies are accepted, because both are shown: "1:30"
 * and "1.5" are the same ninety minutes, and "90m" is too.
 */
export function parseDurationText(text: string): number | null {
  const trimmed = text.trim();
  const clock = /^(\d+):([0-5]\d)$/.exec(trimmed);
  if (clock !== null) return Number(clock[1]) * 60 + Number(clock[2]);
  const decimal = /^(\d+(?:\.\d+)?)\s*h?$/i.exec(trimmed);
  if (decimal !== null) return Math.round(Number(decimal[1]) * 60);
  const minutes = /^(\d+)\s*m$/i.exec(trimmed);
  if (minutes !== null) return Number(minutes[1]);
  return null;
}

/**
 * Why a save cannot go through yet, in the words the reader needs, or null when it can.
 *
 * The rule is the design's: an advance control validates before it enables, so nothing is pressed
 * only to come back with a failure the client could have named.
 */
export function draftRefusal(input: {
  readonly durationText: string;
  readonly description: string;
}): string | null {
  const minutes = parseDurationText(input.durationText);
  if (minutes === null || minutes <= 0) return "Enter the time worked";
  if (input.description.trim() === "") return "Enter a description.";
  return null;
}

/*
 * ---------------------------------------------------------------------------------------------
 * The live timer.
 *
 * The firm's timer is ONE timer per timekeeper, held on the server, not a stopwatch a page owns:
 * starting a second one stops the first, and it survives a reload because the server is what is
 * holding it. That is why the Time Sheet's per-row control is a handle on this timer rather than a
 * counter of its own, and why nothing here keeps state.
 *
 * ELAPSED TIME IS THE CLIENT'S ARITHMETIC. The read answers when the run started, and the client
 * counts forward from it; nothing is polled to make a clock tick. What the read does NOT answer is
 * how much time a run had already banked before it was paused, so a sheet that pauses and resumes
 * inside one session adds up the segments it saw for itself and says so rather than pretending to
 * know a total nobody served.
 */

/** Where the timekeeper's one timer stands. */
export interface TimerState {
  status: "running" | "paused" | "committing" | "abandoned" | "idle";
  liveRunId: string | null;
  /** When the current run segment began, as an instant. Null unless something is running. */
  startedAt: string | null;
  matterId: string | null;
  narrative: string | null;
}

export function readTimer(fetchImpl: typeof fetch): Promise<ApiOutcome<TimerState>> {
  return requestJson(fetchImpl, "/api/v1/timer/read");
}

/**
 * Start the timer, carrying the words the work is being recorded under and the matter it is for.
 *
 * The matter is NULLABLE on the contract, and that is load-bearing rather than an oversight: a
 * person starts a timer before they have decided where the time belongs, and the timer takes it. An
 * unbound run cannot become an entry of its own — the stop-and-commit refuses it — so whoever
 * started one has to say where the time went before it reaches the record.
 */
export function startTimer(
  fetchImpl: typeof fetch,
  input: { readonly matterId: string | null; readonly narrative: string },
  idempotencyKey: string,
): Promise<ApiOutcome<{ liveRunId: string; startedAt: string }>> {
  return requestJson(fetchImpl, "/api/v1/timer/start", {
    method: "POST",
    body: { matterId: input.matterId, narrative: input.narrative },
    idempotencyKey,
  });
}

export function pauseTimer(fetchImpl: typeof fetch): Promise<ApiOutcome<{ ok: boolean }>> {
  return requestJson(fetchImpl, "/api/v1/timer/pause", { method: "POST", body: {} });
}

export function resumeTimer(fetchImpl: typeof fetch): Promise<ApiOutcome<{ ok: boolean }>> {
  return requestJson(fetchImpl, "/api/v1/timer/resume", { method: "POST", body: {} });
}

/** Stop the timer and let it become a draft entry of its own. */
export function stopTimerAndCommit(
  fetchImpl: typeof fetch,
  idempotencyKey: string,
): Promise<ApiOutcome<{ timeEntryId: string }>> {
  return requestJson(fetchImpl, "/api/v1/timer/stop-commit", {
    method: "POST",
    body: {},
    idempotencyKey,
  });
}

/**
 * Stop the timer without letting it mint anything.
 *
 * The sheet uses this when the run belongs to a row that already exists: the elapsed time is added
 * to that entry instead, so the work lands where the person was typing rather than on a second row
 * beside it.
 */
export function discardTimer(fetchImpl: typeof fetch): Promise<ApiOutcome<{ ok: boolean }>> {
  return requestJson(fetchImpl, "/api/v1/timer/discard", { method: "POST", body: {} });
}

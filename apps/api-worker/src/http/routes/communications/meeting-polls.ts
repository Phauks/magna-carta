import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { decodeCursor, encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import {
  GuardedWriteRefusedError,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MeetingId, MeetingPollId } from "@magna-carta/identifiers/types";
import {
  ANSWER_POLL_GUARD,
  answerMeetingPoll,
  answerRefusalReason,
  CLOSE_POLL_GUARD,
  closeMeetingPoll,
  listMeetingPollEntries,
  openMeetingPoll,
  readAttributedPollAnswers,
  readMeetingPollEntry,
  type MeetingPollOptions,
} from "@magna-carta/meetings/poll-service";
import { isPollParticipationConflict } from "@magna-carta/meetings/poll-statements";
import {
  MAX_MEETING_POLL_ANSWER_PAGE_SIZE,
  MAX_MEETING_POLL_OPTIONS,
  MEETING_POLL_KINDS,
  MAX_MEETING_POLL_OPTION_LENGTH,
  MAX_MEETING_POLL_PAGE_SIZE,
  MAX_MEETING_POLL_QUESTION_LENGTH,
  type MeetingPollEntry,
} from "@magna-carta/meetings/poll-types";
import { MeetingPollValidationError } from "@magna-carta/meetings/poll-validation";
import { MEETING_CONTRIBUTOR_KINDS } from "@magna-carta/meetings/types";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
import type { MeetingPollSnapshot } from "@magna-carta/meeting-protocol/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
// The room's own refusals, mapped where the meetings routes map them rather than a second time here,
// so every door in the family gives the same answer for a room that is out of reach.
import { meetingErrorResponse, meetingRoomFor } from "./meetings.ts";

// A MEETING'S POLLS: a host asks the room a closed question, the room answers, a host closes it.
//
// THE ROUTE IS THE RECORD, ON CHAT'S TERMS. Every act is a write through the firm-scoped data-access
// layer with an audit row of identifiers and instants, and the room is told AFTER the commit — so
// nobody is shown a poll, a close or a count by a write that then failed. The browser sends nothing
// new on the socket for any of this; the room relays `poll-opened`, `poll-closed` and a coalesced
// `poll-tally`, and a browser that misses one is caught up by the reads below.
//
// WHO MAY DO WHAT. Reading is `meetings:join` and the event's own visibility, composed through the
// meeting read. Answering is `meetings:join` AND an open stay — being in the room is the whole of the
// permission, as it is for a chat message. Asking, closing and reading who answered what are HOST
// acts: `meetings:host` at the chokepoint AND a live grant on this meeting, asked in the domain
// service, because the key says who a firm lets convene meetings and the grant says who is running
// this one.
//
// ONE REFUSAL FOR EVERY WAY A ROOM IS OUT OF REACH, as the meetings routes hold it: an unknown
// meeting and a meeting on a matter the member may not see are both 404, and a poll in another
// meeting is 404 one level down.

const JOIN = "meetings:join" as const;
const HOST = "meetings:host" as const;

// ---- request/response contracts ----

// THE BOUNDS HERE ARE SANITY BOUNDS, AND THE DOMAIN'S ARE THE CONTRACT. Each is generous by the
// whitespace a browser leaves behind and by a margin on the counts, so an ordinary overreach reaches
// the domain and is answered `meeting-poll-invalid` naming the field — one problem type a surface
// can act on — while an absurd body is refused before it is read.
const OpenPollRequest = z
  .object({
    question: z.string().max(MAX_MEETING_POLL_QUESTION_LENGTH + 64),
    options: z
      .array(z.string().max(MAX_MEETING_POLL_OPTION_LENGTH + 64))
      .max(MAX_MEETING_POLL_OPTIONS * 2),
    // Whether the answers are kept without names. The panel says "Answers are not shown with names"
    // rather than "anonymous", because a reader with the raw database could still correlate rows —
    // what is promised is that no route, export, frame or audit row names who chose what.
    anonymous: z.boolean(),
    // How many options one participant may choose. One is an ordinary poll.
    maxChoices: z.number().int().default(1),
    // What kind of question: pick one, pick several, put them all in order, or give a score (whose
    // options are the scale's points, "1" upward). Without it, the kind follows `maxChoices`.
    kind: z.enum(MEETING_POLL_KINDS).optional(),
  })
  .openapi("OpenMeetingPollRequest");

const AnswerPollRequest = z
  .object({
    // The options chosen — at least one, each once, no more than the poll allows, all of THIS poll.
    optionIds: z.array(z.string().min(1).max(128)).max(MAX_MEETING_POLL_OPTIONS * 2),
  })
  .openapi("AnswerMeetingPollRequest");

const MeetingPollOption = z
  .object({
    optionId: z.string(),
    // 0-based, the order the room sees.
    position: z.number().int(),
    label: z.string(),
    // How many chose it. Every option is present, including the ones nobody chose.
    count: z.number().int(),
    // On a ranking, the average place given this option (1 is first); null on every other kind.
    averageRank: z.number().nullable(),
  })
  .openapi("MeetingPollOption");

export const MeetingPoll = z
  .object({
    id: z.string(),
    meetingId: z.string(),
    askedByUserId: z.string(),
    question: z.string(),
    anonymous: z.boolean(),
    maxChoices: z.number().int(),
    kind: z.enum(MEETING_POLL_KINDS),
    openedAt: z.string(),
    // A closed poll takes no answers; the two are set together or not at all.
    closedAt: z.string().nullable(),
    closedByUserId: z.string().nullable(),
    options: z.array(MeetingPollOption),
    // How many took part — people, not answers.
    respondents: z.number().int(),
    // Whether the CALLER has answered it, from any of their stays in this meeting — what decides
    // whether their card shows the options or the result.
    answeredByCaller: z.boolean(),
  })
  .openapi("MeetingPoll");

const MeetingPollPage = paginated(MeetingPoll).openapi("MeetingPollPage");

const MeetingPollAnswer = z
  .object({
    // The STAY that answered, as a kind and a handle, and the firm member behind it — null for a
    // stay with no member behind it.
    participantKind: z.enum(MEETING_CONTRIBUTOR_KINDS),
    participantId: z.string(),
    userId: z.string().nullable(),
    // What it chose, in the poll's own order.
    optionIds: z.array(z.string()),
    answeredAt: z.string(),
  })
  .openapi("MeetingPollAnswer");

const MeetingPollAnswerPage = paginated(MeetingPollAnswer).openapi("MeetingPollAnswerPage");

const meetingIdParam = z.object({ meetingId: identifierPathParam("meeting", "meetingId") });
const pollParams = z.object({
  meetingId: identifierPathParam("meeting", "meetingId"),
  pollId: identifierPathParam("meetingPoll", "pollId"),
});

const commonErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission, or is not hosting this meeting",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "No meeting — or no poll in it — this member can reach at that address",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limited",
    content: { "application/problem+json": { schema: Problem } },
  },
};

const writeErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  ...commonErrors,
  409: {
    description:
      "The meeting has ended, the caller is not in it, the poll has closed or was already " +
      "answered, or a request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The poll, or the choices, are not ones this poll accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// ---- route metas ----

// `resource: "firm"` on all six, for the reason both meeting keys bind the firm: a meeting hangs from
// a calendar event and a firm event belongs to no matter at all. The matter question is still asked —
// every read composes the visible-matter predicate through the meeting.
function readMeta(action: string, permission: typeof JOIN | typeof HOST): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(action: string, permission: typeof JOIN | typeof HOST): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: true,
    // Required. A retried open must not ask the room twice, and a retried answer must not be a
    // second participation the index then refuses as though the member had tried to vote again.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---- routes ----

const openRoute = defineOpenAPIRoute(writeMeta("openPoll", HOST), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/polls",
  description:
    "Asks the room a closed question. A host act: the caller holds meetings:host and a live " +
    "grant on this meeting. The poll is open from the instant it is written — there is no draft — " +
    "and several may be open at once. `anonymous` keeps the answers without names: nothing this " +
    "API returns, and no frame or audit row, can say who chose what, though who took part is " +
    "never secret. A retried request is answered with the poll's record and its question and " +
    "labels left empty; read the poll for its words.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: OpenPollRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The poll is open and on the record",
      content: { "application/json": { schema: MeetingPoll } },
    },
    ...writeErrors,
  },
});

const listRoute = defineOpenAPIRoute(readMeta("listPolls", JOIN), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/polls",
  description:
    "A meeting's polls, newest first, each with its tally — every option in order with how many " +
    "chose it, including the ones nobody did — how many took part, and whether the caller has " +
    "answered it.",
  request: { params: meetingIdParam, query: cursorQuery },
  responses: {
    200: {
      description: "One page of this meeting's polls",
      content: { "application/json": { schema: MeetingPollPage } },
    },
    ...commonErrors,
  },
});

const readRoute = defineOpenAPIRoute(readMeta("readPoll", JOIN), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/polls/{pollId}",
  description: "One poll, in the shape the list returns.",
  request: { params: pollParams },
  responses: {
    200: {
      description: "The poll",
      content: { "application/json": { schema: MeetingPoll } },
    },
    ...commonErrors,
  },
});

const closeRoute = defineOpenAPIRoute(writeMeta("closePoll", HOST), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/polls/{pollId}/close",
  description:
    "Closes a poll, which cannot be undone: a closed poll refuses answers. A host act. A poll " +
    "already closed answers 200 unchanged rather than moving the instant already on the record. " +
    "Still available after the meeting has ended.",
  request: { params: pollParams, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The poll is closed",
      content: { "application/json": { schema: MeetingPoll } },
    },
    ...writeErrors,
  },
});

// THE ANSWER'S IDEMPOTENCY RECORD KEEPS NOTHING THE CHOICE COULD BE READ BACK OUT OF. The default
// fingerprint is an unsalted digest over the body, and a body that is a choice among at most ten
// options is recovered from it by hashing each candidate — next to an instant that sits beside the
// respondent row naming the stay. So this route is fingerprinted over its path alone, and its stored
// response is the poll's handle alone (see the handler). The trade: a retry under the same key that
// carries DIFFERENT choices is not told apart from the first request and is answered as it was —
// which can never record a second answer, because an answer cannot be changed.
const answerRoute = defineOpenAPIRoute(
  { ...writeMeta("answerPoll", JOIN), idempotencyFingerprint: "path" },
  {
    method: "post",
    path: "/api/v1/meetings/{meetingId}/polls/{pollId}/answers",
    description:
      "Answers a poll from the caller's open stay — being in the room is the whole of the " +
      "permission, so a member who has left is answered as one who is not in the meeting. One " +
      "participation per member per poll, however many options it chooses, and an answer cannot " +
      "be changed: a second is 409 `meeting-poll-already-answered`, including from a later stay " +
      "after leaving and rejoining. A retry under the same Idempotency-Key is answered with the " +
      "poll as it stands now, whatever choices the retry carries: the key's record keeps nothing " +
      "the choice could be read back out of, so it cannot tell two bodies apart.",
    request: {
      params: pollParams,
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: AnswerPollRequest } }, required: true },
    },
    responses: {
      200: {
        description: "The answer is on the record; the poll as the caller now sees it",
        content: { "application/json": { schema: MeetingPoll } },
      },
      ...writeErrors,
    },
  },
);

const answersRoute = defineOpenAPIRoute(readMeta("listPollAnswers", HOST), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/polls/{pollId}/answers",
  description:
    "Who answered what, on a poll that shows names — a host read, one page of participations " +
    "oldest first. Refused 409 `meeting-poll-answers-not-attributed` on a poll that does not show " +
    "names, rather than answered with an empty page that would read as nobody having answered.",
  request: { params: pollParams, query: cursorQuery },
  responses: {
    200: {
      description: "One page of who answered what",
      content: { "application/json": { schema: MeetingPollAnswerPage } },
    },
    ...commonErrors,
    409: {
      description: "The poll does not show names with its answers",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// ---- refusals ----

function pollErrorResponse(
  c: Context,
  caught: MeetingPollValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "meeting-poll-not-found":
      return problemJson(c, {
        type: "meeting-poll-not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "meeting-poll-closed":
      return problemJson(c, {
        type: "meeting-poll-closed",
        title: "This poll has closed",
        status: 409,
        detail: caught.message,
      });
    case "meeting-poll-already-answered":
      return problemJson(c, {
        type: "meeting-poll-already-answered",
        title: "You have already answered this poll",
        status: 409,
        detail: caught.message,
      });
    case "meeting-poll-answers-not-attributed":
      return problemJson(c, {
        type: "meeting-poll-answers-not-attributed",
        title: "This poll does not show names with its answers",
        status: 409,
        detail: caught.message,
      });
    // ONE TYPE, AND THE FIELD NAMED TWICE: at the head of `detail` for a reader, and as the path of
    // the one field-level error for a form that wants to put the sentence beside the right input.
    case "meeting-poll-invalid": {
      const field = caught.field ?? "$";
      return problemJson(c, {
        type: "meeting-poll-invalid",
        title: "That poll is not one this meeting accepts",
        status: 422,
        detail: `${field}: ${caught.message}`,
        errors: [{ path: field, code: "meeting-poll-invalid", detail: caught.message }],
      });
    }
  }
}

function notFound(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "meeting-not-found",
    title: "Not found",
    status: 404,
    detail: "No such meeting in this firm.",
  });
}

// ---- helpers ----

function pollOptions(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): MeetingPollOptions {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
    // The same predicate every calendar source composes, so a poll in a room a list read could not
    // reach is as absent as the room.
    visibility: visibleMatterPredicate(),
  };
}

/**
 * The poll as a retry is answered with — its record, with THE WORDS LEFT OUT.
 *
 * `idempotency_key.response_body` is served verbatim to whoever retries the key, and nothing about a
 * matter's content belongs in that table: packages/data-access/src/idempotency-statements.ts holds
 * every stored body to it. So the handle, the instants, the shape and the counts are stored, and the
 * question and the labels are empty strings — the chat route's rule for a message body. The words
 * are on the poll, one read away.
 */
function pollWithoutWords(poll: MeetingPollEntry): MeetingPollEntry {
  return {
    ...poll,
    question: "",
    options: poll.options.map((option) => ({ ...option, label: "" })),
  };
}

/** The poll as the response carries it — the same object, with its option list handed over whole. */
function wirePoll(poll: MeetingPollEntry): z.infer<typeof MeetingPoll> {
  return { ...poll, options: [...poll.options] };
}

/** The copy the room relays: the poll less the one field that is about a single reader. */
function snapshotOf(poll: MeetingPollEntry): MeetingPollSnapshot {
  return {
    id: poll.id,
    meetingId: poll.meetingId,
    askedByUserId: poll.askedByUserId,
    question: poll.question,
    anonymous: poll.anonymous,
    maxChoices: poll.maxChoices,
    kind: poll.kind,
    openedAt: poll.openedAt,
    closedAt: poll.closedAt,
    closedByUserId: poll.closedByUserId,
    options: poll.options,
    respondents: poll.respondents,
  };
}

type PollOutcome =
  | { ok: true; pollId: string; executed: boolean; replayed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<403>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

/** What one poll write composed: the poll it is about, and what its idempotency record keeps. */
interface ComposedPollWrite {
  readonly pollId: MeetingPollId;
  readonly responseCode: number;
  // What `idempotency_key.response_body` holds. Never the words (pollWithoutWords), and on the
  // answer route not even the counts — only the handle, re-read on a retry (answerRoute).
  readonly responseBody: string;
  readonly effect: EffectWrite;
}

/**
 * Runs one poll write through the idempotency gate, mapping both refusal vocabularies — the room's
 * and the poll's — and the races the database settles.
 *
 * `executed` says whether THIS request committed anything, which is what decides whether the room is
 * told: a replay committed nothing, and telling the room twice would put a second copy of a poll on
 * every screen. A close that produced no statements (the poll was already closed) is executed but
 * reports `changed: false` through the service, and the caller does not relay it either. `replayed`
 * says the answer came from an earlier request's record, which the response header repeats.
 *
 * A CLOSE THAT LOST A RACE IS A SUCCESS: another host closed it in the same instant, which is the
 * state asked for. AN ANSWER THAT LOST ONE IS NOT: the guard matched nothing because the poll closed
 * or because this member's answer from another stay landed first, and the member is told which.
 */
async function commitPollEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  meetingId: MeetingId,
  call: () => Promise<ComposedPollWrite>,
): Promise<PollOutcome> {
  let composed: { pollId: MeetingPollId } | undefined;
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { pollId, responseCode, responseBody, effect } = await call();
        composed = { pollId };
        return { write: effect, responseCode, responseBody };
      },
    });
  } catch (caught) {
    if (caught instanceof MeetingPollValidationError) {
      return { ok: false, problem: pollErrorResponse(c, caught) };
    }
    if (caught instanceof MeetingValidationError) {
      return { ok: false, problem: meetingErrorResponse(c, caught) };
    }
    if (caught instanceof GuardedWriteRefusedError && composed !== undefined) {
      if (caught.guard === CLOSE_POLL_GUARD) {
        return { ok: true, pollId: composed.pollId, executed: false, replayed: false };
      }
      if (caught.guard === ANSWER_POLL_GUARD) {
        const reason = await answerRefusalReason(database, meetingId, composed.pollId);
        return {
          ok: false,
          problem: pollErrorResponse(
            c,
            new MeetingPollValidationError(
              reason,
              reason === "meeting-poll-closed"
                ? "this poll has closed"
                : "you have already answered this poll",
            ),
          ),
        };
      }
    }
    // THE OTHER HALF OF THE SAME RACE, through the index rather than the guard: two answers from one
    // stay committing in the same instant.
    if (isPollParticipationConflict(caught)) {
      return {
        ok: false,
        problem: pollErrorResponse(
          c,
          new MeetingPollValidationError(
            "meeting-poll-already-answered",
            "you have already answered this poll",
          ),
        ),
      };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  // Every stored body carries the handle under `id` — the whole poll on the open and the close, the
  // handle alone on an answer — and the handle is all a retry needs to read the record again.
  const stored = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return {
    ok: true,
    pollId: stored.id,
    executed: result.kind === "executed",
    replayed: result.kind === "replayed",
  };
}

/**
 * The poll as the record now holds it, for this caller — read after the write rather than projected
 * from what the service composed, so what a member is told is what the record says. A handle that
 * answers nothing here is a fault: the write it came from has committed.
 */
async function pollOnTheRecord(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  database: BatchDatabase,
  meetingId: MeetingId,
  pollId: string,
): Promise<MeetingPollEntry> {
  try {
    return await readMeetingPollEntry(database, meetingId, pollId as MeetingPollId, pollOptions(c));
  } catch (caught) {
    throw new Error(
      `meeting polls: poll ${pollId} committed in meeting ${meetingId} could not be read back`,
      { cause: caught },
    );
  }
}

// ---- registration ----

export function registerMeetingPollRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/meetings/{meetingId}/polls
  app.openapi(
    { ...openRoute, middleware: chokepointMiddleware(chokepoint, openRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const body = c.req.valid("json");

      const outcome = await commitPollEffect(
        c,
        firm.firmDatabase,
        idempotency,
        meetingId as MeetingId,
        async () => {
          const opened = await openMeetingPoll(
            firm.firmDatabase,
            meetingId as MeetingId,
            {
              ...body,
              // A caller that predates kinds says only how many may be chosen.
              kind: body.kind ?? (body.maxChoices > 1 ? "multiple" : "one"),
            },
            pollOptions(c),
          );
          return {
            pollId: opened.poll.id,
            responseCode: 201,
            responseBody: canonicalJsonStringify(pollWithoutWords(opened.poll)),
            effect: opened.effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      const poll = await pollOnTheRecord(
        c,
        firm.firmDatabase,
        meetingId as MeetingId,
        outcome.pollId,
      );
      // AFTER the commit, and only for the request that committed it. The poll WHOLE rather than a
      // handle, so three hundred browsers are not sent to the read in the same instant.
      if (outcome.executed) {
        await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).pollOpened(
          snapshotOf(poll),
        );
      }
      return c.json(wirePoll(poll), 201);
    },
  );

  // GET /api/v1/meetings/{meetingId}/polls
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      let found;
      try {
        found = await listMeetingPollEntries(
          firm.firmDatabase,
          meetingId as MeetingId,
          { cursor: decodeCursor(cursor), limit: MAX_MEETING_POLL_PAGE_SIZE },
          pollOptions(c),
        );
      } catch (caught) {
        if (caught instanceof MeetingValidationError) return notFound(c);
        throw caught;
      }
      // The read asks for one row past the page, and that row is the answer to "is there more".
      const hasMore = found.length > MAX_MEETING_POLL_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_MEETING_POLL_PAGE_SIZE) : found;
      const last = rows.at(-1);
      return c.json(
        {
          data: rows.map(wirePoll),
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.openedAt, last.id) : null,
        },
        200,
      );
    },
  );

  // GET /api/v1/meetings/{meetingId}/polls/{pollId}
  app.openapi(
    { ...readRoute, middleware: chokepointMiddleware(chokepoint, readRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId, pollId } = c.req.valid("param");
      try {
        return c.json(
          wirePoll(
            await readMeetingPollEntry(
              firm.firmDatabase,
              meetingId as MeetingId,
              pollId as MeetingPollId,
              pollOptions(c),
            ),
          ),
          200,
        );
      } catch (caught) {
        if (caught instanceof MeetingValidationError) return notFound(c);
        if (caught instanceof MeetingPollValidationError) {
          return problemJson(c, {
            type: "meeting-poll-not-found",
            title: "Not found",
            status: 404,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );

  // POST /api/v1/meetings/{meetingId}/polls/{pollId}/close
  app.openapi(
    { ...closeRoute, middleware: chokepointMiddleware(chokepoint, closeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, pollId } = c.req.valid("param");

      // Whether the write moved anything, kept from inside the effect: a poll that was already
      // closed produces no statements, and there is nothing the room needs telling.
      let changed = false;
      const outcome = await commitPollEffect(
        c,
        firm.firmDatabase,
        idempotency,
        meetingId as MeetingId,
        async () => {
          const closing = await closeMeetingPoll(
            firm.firmDatabase,
            meetingId as MeetingId,
            pollId as MeetingPollId,
            pollOptions(c),
          );
          changed = closing.closed;
          const current = await readMeetingPollEntry(
            firm.firmDatabase,
            meetingId as MeetingId,
            pollId as MeetingPollId,
            pollOptions(c),
          );
          return {
            pollId: current.id,
            responseCode: 200,
            responseBody: canonicalJsonStringify(
              pollWithoutWords({
                ...current,
                closedAt: closing.poll.closed_at,
                closedByUserId: closing.poll.closed_by_user_id,
              }),
            ),
            effect: closing.effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      const poll = await pollOnTheRecord(
        c,
        firm.firmDatabase,
        meetingId as MeetingId,
        outcome.pollId,
      );
      // The FINAL tally rides the close, read off the settled record, so every card switches to its
      // result without a read.
      if (outcome.executed && changed && poll.closedAt !== null) {
        await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).pollClosed(
          poll.id,
          poll.closedAt,
          {
            counts: poll.options.map((option) => ({
              optionId: option.optionId,
              count: option.count,
              averageRank: option.averageRank,
            })),
            respondents: poll.respondents,
          },
        );
      }
      return c.json(wirePoll(poll), 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/polls/{pollId}/answers
  app.openapi(
    { ...answerRoute, middleware: chokepointMiddleware(chokepoint, answerRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, pollId } = c.req.valid("param");
      const { optionIds } = c.req.valid("json");

      const outcome = await commitPollEffect(
        c,
        firm.firmDatabase,
        idempotency,
        meetingId as MeetingId,
        async () => {
          const { effect } = await answerMeetingPoll(
            firm.firmDatabase,
            meetingId as MeetingId,
            pollId as MeetingPollId,
            { optionIds },
            pollOptions(c),
          );
          // THE HANDLE AND NOTHING ELSE is kept for a retry. The poll's counts as they stood a moment
          // before this answer, stored here and again beside the next member's answer, would let
          // anybody holding the table subtract one body from the next and read each choice off the
          // difference — on a poll that promised not to show names. A retry reads the poll afresh.
          return {
            pollId: pollId as MeetingPollId,
            responseCode: 200,
            responseBody: canonicalJsonStringify({ id: pollId }),
            effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      // THE INSTANT IS TAKEN BEFORE THE READ, so a read that started later has seen every commit an
      // earlier one saw. The room orders a poll's tallies by respondents, which only grow, and keeps
      // the instant beside them for the frame.
      const readAt = new Date().toISOString();
      const poll = await pollOnTheRecord(
        c,
        firm.firmDatabase,
        meetingId as MeetingId,
        outcome.pollId,
      );
      // A retry is answered from the record as it stands now, and says so the way every other
      // replayed request does.
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      if (outcome.executed) {
        await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).pollAnswered(poll.id, {
          counts: poll.options.map((option) => ({
            optionId: option.optionId,
            count: option.count,
            averageRank: option.averageRank,
          })),
          respondents: poll.respondents,
          readAt,
        });
      }
      return c.json(wirePoll(poll), 200);
    },
  );

  // GET /api/v1/meetings/{meetingId}/polls/{pollId}/answers
  app.openapi(
    { ...answersRoute, middleware: chokepointMiddleware(chokepoint, answersRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId, pollId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      let found;
      try {
        found = await readAttributedPollAnswers(
          firm.firmDatabase,
          meetingId as MeetingId,
          pollId as MeetingPollId,
          { cursor: decodeCursor(cursor), limit: MAX_MEETING_POLL_ANSWER_PAGE_SIZE },
          pollOptions(c),
        );
      } catch (caught) {
        // The two refusals a read can meet — a poll out of reach, and a poll that shows no names —
        // and the room's own, which includes the grant this read asks for.
        if (caught instanceof MeetingPollValidationError) {
          if (caught.code === "meeting-poll-not-found") {
            return problemJson(c, {
              type: "meeting-poll-not-found",
              title: "Not found",
              status: 404,
              detail: caught.message,
            });
          }
          if (caught.code === "meeting-poll-answers-not-attributed") {
            return problemJson(c, {
              type: "meeting-poll-answers-not-attributed",
              title: "This poll does not show names with its answers",
              status: 409,
              detail: caught.message,
            });
          }
        }
        if (caught instanceof MeetingValidationError) return meetingErrorResponse(c, caught);
        throw caught;
      }
      const hasMore = found.length > MAX_MEETING_POLL_ANSWER_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_MEETING_POLL_ANSWER_PAGE_SIZE) : found;
      const last = rows.at(-1);
      return c.json(
        {
          data: rows.map((row) => ({
            participantKind: row.participantKind,
            participantId: row.participantId,
            userId: row.userId,
            optionIds: [...row.optionIds],
            answeredAt: row.answeredAt,
          })),
          nextCursor:
            hasMore && last !== undefined ? encodeCursor(last.answeredAt, last.respondentId) : null,
        },
        200,
      );
    },
  );
}

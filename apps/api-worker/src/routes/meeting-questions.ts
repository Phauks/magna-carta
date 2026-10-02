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
import type { MeetingId, MeetingQuestionId, UserId } from "@magna-carta/identifiers/types";
import {
  ASK_QUESTION_GUARD,
  askMeetingQuestion,
  listMeetingQuestionEntries,
  MARK_ANSWERED_GUARD,
  readMeetingQuestionEntry,
  REDACT_QUESTION_GUARD,
  redactMeetingQuestion,
  setMeetingQuestionAnswered,
  UPVOTE_QUESTION_GUARD,
  upvoteMeetingQuestion,
  WITHDRAW_UPVOTE_GUARD,
  withdrawMeetingQuestionUpvote,
  type MeetingQuestionOptions,
} from "@magna-carta/meetings/question-service";
import { isQuestionUpvoteConflict } from "@magna-carta/meetings/question-statements";
import {
  MAX_MEETING_QUESTION_LENGTH,
  MAX_MEETING_QUESTION_PAGE_SIZE,
  type MeetingQuestionEntry,
} from "@magna-carta/meetings/question-types";
import { MeetingQuestionValidationError } from "@magna-carta/meetings/question-validation";
import { MEETING_CONTRIBUTOR_KINDS } from "@magna-carta/meetings/types";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
import type { MeetingQuestionSnapshot } from "@magna-carta/meeting-protocol/types";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../contracts/common.ts";
import { cursorQuery, paginated } from "../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { meetingErrorResponse, meetingRoomFor } from "./meetings.ts";

// A MEETING'S QUESTION QUEUE: the room asks the host. Anybody in the room asks and upvotes; a host
// marks a question answered as they work through the queue; the author or a host takes one back.
//
// ON CHAT'S TERMS EXACTLY. A question is content said in a meeting — retained under the matter,
// personal data, taken back by a redaction that blanks the body and keeps the row — and every act is
// a route whose write goes through the firm-scoped data-access layer, with the room told AFTER the
// commit: `question-asked`, `question-updated`, and a coalesced `question-tally` for the counts.
//
// WHO MAY DO WHAT. Reading is `meetings:join` through the meeting's own visibility. Asking, upvoting
// and withdrawing an upvote are `meetings:join` AND an open stay. Marking answered is a HOST act —
// `meetings:host` and a live grant, asked in the domain service. Taking a question back rides
// `meetings:join` and is decided inside, because the AUTHOR may do it without holding the key.

const JOIN = "meetings:join" as const;
const HOST = "meetings:host" as const;

// ---- request/response contracts ----

const AskQuestionRequest = z
  .object({
    // Bounded generously by the whitespace a browser leaves behind; the domain trims the edges and
    // measures what will be stored, and answers `meeting-question-too-long` past the ceiling.
    body: z
      .string()
      .min(1)
      .max(MAX_MEETING_QUESTION_LENGTH + 64),
  })
  .openapi("AskMeetingQuestionRequest");

const SetAnsweredRequest = z
  .object({ answered: z.boolean() })
  .openapi("SetMeetingQuestionAnsweredRequest");

export const MeetingQuestion = z
  .object({
    id: z.string(),
    meetingId: z.string(),
    // The STAY it was asked from, as a kind and a handle, and the firm member behind it — null for a
    // stay with no member behind it.
    participantKind: z.enum(MEETING_CONTRIBUTOR_KINDS),
    participantId: z.string(),
    userId: z.string().nullable(),
    // Empty exactly when the question has been taken back.
    body: z.string(),
    askedAt: z.string(),
    answeredAt: z.string().nullable(),
    answeredByUserId: z.string().nullable(),
    redactedAt: z.string().nullable(),
    redactedByUserId: z.string().nullable(),
    // Counted over the upvotes on every read.
    upvotes: z.number().int(),
    // Whether the CALLER has upvoted it, from any of their stays — what draws the control.
    upvotedByCaller: z.boolean(),
  })
  .openapi("MeetingQuestion");

const MeetingQuestionPage = paginated(MeetingQuestion).openapi("MeetingQuestionPage");

// THE QUEUE IS WALKED BY ITS OWN STABLE KEY AND SORTED IN THE BROWSER. The panel shows the most
// upvoted first, but a cursor over a count that changes while the reader pages repeats rows and
// skips them, so the page is ordered by `(asked_at, id)` and the browser sorts what it holds — the
// queue's ceiling is what makes holding all of it honest. `since` with `sinceId` is a position in
// that same ordering, spelled out for a panel following the queue; two instants compare the same in
// every zone, which is why this one is the caller's to derive.
const listQuestionsQuery = cursorQuery.extend({
  since: z.string().datetime().optional(),
  sinceId: z.string().optional(),
});

const meetingIdParam = z.object({ meetingId: identifierPathParam("meeting", "meetingId") });
const questionParams = z.object({
  meetingId: identifierPathParam("meeting", "meetingId"),
  questionId: identifierPathParam("meetingQuestion", "questionId"),
});

const commonErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description:
      "The session member lacks the required permission, is not hosting this meeting, or may not " +
      "take this question back",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "No meeting — or no question in it — this member can reach at that address",
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
      "The meeting has ended, the caller is not in it, the queue is full, the question has been " +
      "taken back, or a request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The question is empty, or longer than a question may be",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// ---- route metas ----

function readMeta(action: string): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission: JOIN,
    // The firm, for the reason both meeting keys bind it; the matter question is asked through the
    // meeting read.
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
    // Required. A retried question must not be asked twice — the queue is a record of what the room
    // asked, and a duplicated line is a record of something that did not happen.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---- routes ----

const askRoute = defineOpenAPIRoute(writeMeta("askQuestion", JOIN), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/questions",
  description:
    "Puts a question to the room from the caller's open stay — being in the room is the whole of " +
    "the permission. A meeting's queue holds 500 questions at most; the 501st is 409 " +
    "`meeting-question-limit-reached`. A retried request is answered with the question's record " +
    "and an empty body: the words are kept in the queue, which is the one copy a taking-back can " +
    "reach.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: AskQuestionRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The question is on the record",
      content: { "application/json": { schema: MeetingQuestion } },
    },
    ...writeErrors,
  },
});

const listRoute = defineOpenAPIRoute(readMeta("listQuestions"), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/questions",
  description:
    "A meeting's question queue, oldest first and paged on (asked_at, id) — the record's own stable " +
    "key. Sort by upvotes in the client over the page it holds: a cursor over a count that changes " +
    "while the reader pages would repeat and skip rows. `since` with `sinceId` continues from the " +
    "last question a panel holds, on the same key as the cursor. `since` alone is INCLUSIVE — it " +
    "returns every question asked at or after that instant, so one committed in the same " +
    "millisecond as the last one held is never skipped — and the caller drops the ids it already " +
    "holds. A question that has been taken back is still returned, with an empty body beside who " +
    "removed it and when.",
  request: { params: meetingIdParam, query: listQuestionsQuery },
  responses: {
    200: {
      description: "One page of this meeting's questions",
      content: { "application/json": { schema: MeetingQuestionPage } },
    },
    ...commonErrors,
  },
});

// THE UPVOTE AND ITS WITHDRAWAL SPEND A BUCKET OF THE MEMBER'S OWN. Both are one tap, a panel
// re-reads the question after each, and a browser looping on the pair would otherwise spend the
// firm's whole default budget — every colleague's next read refused for an act that was not theirs.
// The chokepoint keys this bucket by the member within the firm (rate-limiter.ts).
function upvoteMeta(action: string): RouteMeta {
  return { ...writeMeta(action, JOIN), rateLimit: "meeting-question-upvote" };
}

const upvoteRoute = defineOpenAPIRoute(upvoteMeta("upvoteQuestion"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/questions/{questionId}/upvotes",
  description:
    "Upvotes a question from the caller's open stay. One per member, and idempotent: a member who " +
    "has already upvoted it — from this stay or an earlier one — answers 200 unchanged. A " +
    "question that has been taken back takes no upvotes: 409. Upvoting and withdrawing share a " +
    "rate limit of the caller's own, apart from the firm's.",
  request: { params: questionParams, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The question as the caller now sees it",
      content: { "application/json": { schema: MeetingQuestion } },
    },
    ...writeErrors,
  },
});

const withdrawRoute = defineOpenAPIRoute(upvoteMeta("withdrawQuestionUpvote"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/questions/{questionId}/upvotes/withdrawal",
  description:
    "Takes the caller's upvote back — an upvote that cannot be withdrawn is a vote, not a signal. " +
    "A member with no upvote on it answers 200 unchanged. Still allowed on a question that has " +
    "been taken back, so a member can always clear a signal they gave.",
  request: { params: questionParams, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The question as the caller now sees it",
      content: { "application/json": { schema: MeetingQuestion } },
    },
    ...writeErrors,
  },
});

const answeredRoute = defineOpenAPIRoute(writeMeta("setQuestionAnswered", HOST), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/questions/{questionId}/answered",
  description:
    "Marks a question answered, or unmarks it — a host works a queue fast and marks the wrong row, " +
    "so the act takes a boolean rather than being one-way. A host act: meetings:host and a live " +
    "grant on this meeting. A question already in the state asked for answers 200 unchanged.",
  request: {
    params: questionParams,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SetAnsweredRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The question as the record now holds it",
      content: { "application/json": { schema: MeetingQuestion } },
    },
    ...writeErrors,
  },
});

const redactRoute = defineOpenAPIRoute(writeMeta("redactQuestion", JOIN), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/questions/{questionId}/redact",
  description:
    "Takes a question back: the body is blanked and the row is kept. The author may do this to " +
    "their own question and a host of this meeting to anybody's; a question already taken back " +
    "answers 200 unchanged. Still available after the meeting has ended.",
  request: { params: questionParams, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The question has been taken back",
      content: { "application/json": { schema: MeetingQuestion } },
    },
    ...writeErrors,
  },
});

// ---- refusals ----

function questionErrorResponse(
  c: Context,
  caught: MeetingQuestionValidationError,
): ProblemResponse<403> | ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "meeting-question-not-found":
      return problemJson(c, {
        type: "meeting-question-not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "meeting-question-too-long":
      return problemJson(c, {
        type: "meeting-question-too-long",
        title: "That question is too long",
        status: 422,
        detail: caught.message,
      });
    case "meeting-question-empty":
      return problemJson(c, {
        type: "validation",
        title: "That question is empty",
        status: 422,
        detail: caught.message,
      });
    case "meeting-question-limit-reached":
      return problemJson(c, {
        type: "meeting-question-limit-reached",
        title: "This meeting's question queue is full",
        status: 409,
        detail: caught.message,
      });
    // Taken back: what was asked is gone, so there is nothing left to agree with. The generic
    // conflict type, on chat's precedent that nothing more is done to content once it is removed.
    case "meeting-question-redacted":
      return problemJson(c, {
        type: "conflict",
        title: "This question has been taken back",
        status: 409,
        detail: caught.message,
      });
    // Somebody else's question, and the caller is not hosting — a permission answer rather than an
    // absence, because the question is one they can see in the queue.
    case "meeting-question-not-redactable":
      return problemJson(c, {
        type: "permission-denied",
        title: "Permission denied",
        status: 403,
        detail: caught.message,
        requestAccess: false,
      });
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

function questionOptions(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): MeetingQuestionOptions {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
    visibility: visibleMatterPredicate(),
  };
}

/** The copy the room relays: the question less the one field that is about a single reader. */
function snapshotOf(question: MeetingQuestionEntry): MeetingQuestionSnapshot {
  return {
    id: question.id,
    meetingId: question.meetingId,
    participantKind: question.participantKind,
    participantId: question.participantId,
    userId: question.userId,
    body: question.body,
    askedAt: question.askedAt,
    answeredAt: question.answeredAt,
    answeredByUserId: question.answeredByUserId,
    redactedAt: question.redactedAt,
    redactedByUserId: question.redactedByUserId,
    upvotes: question.upvotes,
  };
}

type QuestionOutcome =
  | { ok: true; questionId: string; executed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<403>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

// THE LABELS WHOSE ZERO IS THE STATE THE CALLER ASKED FOR. Each of these guards matches nothing only
// because the same member's — or another host's — identical act landed first, so the request is
// answered as the success it is and the room is told by the request that actually moved the record.
const SETTLED_BY_AN_EARLIER_ACT = new Set([
  UPVOTE_QUESTION_GUARD,
  WITHDRAW_UPVOTE_GUARD,
  MARK_ANSWERED_GUARD,
  REDACT_QUESTION_GUARD,
]);

/**
 * Runs one question write through the idempotency gate, mapping both refusal vocabularies and the
 * races the database settles.
 *
 * THE STORED BODY CARRIES THE QUESTION'S RECORD AND NOT ITS WORDS, for the chat route's reason:
 * `idempotency_key.response_body` is served verbatim to whoever retries the key, and a redaction
 * cannot reach it — the words would outlive the taking-back that was meant to remove them.
 *
 * `executed` says whether THIS request committed anything, which decides whether the room is told.
 */
async function commitQuestionEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  call: () => Promise<{
    question: MeetingQuestionEntry;
    responseCode: number;
    effect: EffectWrite;
  }>,
): Promise<QuestionOutcome> {
  let composed: { questionId: string } | undefined;
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { question, responseCode, effect } = await call();
        composed = { questionId: question.id };
        return {
          write: effect,
          responseCode,
          responseBody: canonicalJsonStringify({ ...question, body: WORDS_NOT_REPLAYED }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof MeetingQuestionValidationError) {
      return { ok: false, problem: questionErrorResponse(c, caught) };
    }
    if (caught instanceof MeetingValidationError) {
      return { ok: false, problem: meetingErrorResponse(c, caught) };
    }
    if (caught instanceof GuardedWriteRefusedError && composed !== undefined) {
      if (caught.guard === ASK_QUESTION_GUARD) {
        return {
          ok: false,
          problem: questionErrorResponse(
            c,
            new MeetingQuestionValidationError(
              "meeting-question-limit-reached",
              "this meeting's question queue is full",
            ),
          ),
        };
      }
      if (SETTLED_BY_AN_EARLIER_ACT.has(caught.guard)) {
        return { ok: true, questionId: composed.questionId, executed: false };
      }
    }
    // The same member's two upvotes from one stay committing in the same instant: the index kept
    // one, which is what they asked for.
    if (isQuestionUpvoteConflict(caught) && composed !== undefined) {
      return { ok: true, questionId: composed.questionId, executed: false };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const stored = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return { ok: true, questionId: stored.id, executed: result.kind === "executed" };
}

// What a retried write is answered with in place of the words — the chat route's value and reason.
const WORDS_NOT_REPLAYED = "";

/**
 * The question as the record now holds it, for this caller. A handle that answers nothing here is a
 * fault rather than a 404: the write it came from has committed.
 */
async function questionOnTheRecord(
  database: BatchDatabase,
  meetingId: MeetingId,
  questionId: string,
  userId: UserId,
): Promise<MeetingQuestionEntry> {
  const entry = await readMeetingQuestionEntry(
    database,
    meetingId,
    questionId as MeetingQuestionId,
    userId,
  );
  if (entry === undefined) {
    throw new Error(
      `meeting questions: question ${questionId} committed in meeting ${meetingId} could not be read back`,
    );
  }
  return entry;
}

/** The question as it stands before a write, for the composed response the gate stores. */
async function questionBefore(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  database: BatchDatabase,
  meetingId: MeetingId,
  questionId: MeetingQuestionId,
): Promise<MeetingQuestionEntry> {
  const entry = await readMeetingQuestionEntry(
    database,
    meetingId,
    questionId,
    requireChokepointUserId(c),
  );
  if (entry === undefined) {
    throw new MeetingQuestionValidationError(
      "meeting-question-not-found",
      "that is not a question you can reach",
    );
  }
  return entry;
}

// ---- registration ----

export function registerMeetingQuestionRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/meetings/{meetingId}/questions
  app.openapi(
    { ...askRoute, middleware: chokepointMiddleware(chokepoint, askRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const { body } = c.req.valid("json");

      const outcome = await commitQuestionEffect(c, firm.firmDatabase, idempotency, async () => {
        const asked = await askMeetingQuestion(
          firm.firmDatabase,
          meetingId as MeetingId,
          { body },
          questionOptions(c),
        );
        return { question: asked.question, responseCode: 201, effect: asked.effect };
      });
      if (!outcome.ok) return outcome.problem;
      const question = await questionOnTheRecord(
        firm.firmDatabase,
        meetingId as MeetingId,
        outcome.questionId,
        requireChokepointUserId(c),
      );
      // AFTER the commit, and only for the request that committed it — the question whole, so the
      // room is not sent to the read at once.
      if (outcome.executed) {
        await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).questionAsked(
          snapshotOf(question),
        );
      }
      return c.json(question, 201);
    },
  );

  // GET /api/v1/meetings/{meetingId}/questions
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId } = c.req.valid("param");
      const { cursor, since, sinceId } = c.req.valid("query");
      let found;
      try {
        found = await listMeetingQuestionEntries(
          firm.firmDatabase,
          meetingId as MeetingId,
          {
            cursor: decodeCursor(cursor),
            limit: MAX_MEETING_QUESTION_PAGE_SIZE,
            since,
            sinceId,
          },
          questionOptions(c),
        );
      } catch (caught) {
        if (caught instanceof MeetingValidationError) return notFound(c);
        throw caught;
      }
      const hasMore = found.length > MAX_MEETING_QUESTION_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_MEETING_QUESTION_PAGE_SIZE) : found;
      const last = rows.at(-1);
      return c.json(
        {
          data: [...rows],
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.askedAt, last.id) : null,
        },
        200,
      );
    },
  );

  // POST /api/v1/meetings/{meetingId}/questions/{questionId}/upvotes
  app.openapi(
    { ...upvoteRoute, middleware: chokepointMiddleware(chokepoint, upvoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, questionId } = c.req.valid("param");
      let changed = false;
      const outcome = await commitQuestionEffect(c, firm.firmDatabase, idempotency, async () => {
        const upvote = await upvoteMeetingQuestion(
          firm.firmDatabase,
          meetingId as MeetingId,
          questionId as MeetingQuestionId,
          questionOptions(c),
        );
        changed = upvote.upvoted;
        const before = await questionBefore(
          c,
          firm.firmDatabase,
          meetingId as MeetingId,
          questionId as MeetingQuestionId,
        );
        return {
          question: { ...before, upvotedByCaller: true },
          responseCode: 200,
          effect: upvote.effect,
        };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(
        await afterUpvoteChange(c, firm.firmDatabase, meetingId, outcome, changed),
        200,
      );
    },
  );

  // POST /api/v1/meetings/{meetingId}/questions/{questionId}/upvotes/withdrawal
  app.openapi(
    { ...withdrawRoute, middleware: chokepointMiddleware(chokepoint, withdrawRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, questionId } = c.req.valid("param");
      let changed = false;
      const outcome = await commitQuestionEffect(c, firm.firmDatabase, idempotency, async () => {
        const withdrawal = await withdrawMeetingQuestionUpvote(
          firm.firmDatabase,
          meetingId as MeetingId,
          questionId as MeetingQuestionId,
          questionOptions(c),
        );
        changed = withdrawal.withdrawn;
        const before = await questionBefore(
          c,
          firm.firmDatabase,
          meetingId as MeetingId,
          questionId as MeetingQuestionId,
        );
        return {
          question: { ...before, upvotedByCaller: false },
          responseCode: 200,
          effect: withdrawal.effect,
        };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(
        await afterUpvoteChange(c, firm.firmDatabase, meetingId, outcome, changed),
        200,
      );
    },
  );

  // POST /api/v1/meetings/{meetingId}/questions/{questionId}/answered
  app.openapi(
    { ...answeredRoute, middleware: chokepointMiddleware(chokepoint, answeredRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, questionId } = c.req.valid("param");
      const { answered } = c.req.valid("json");
      let changed = false;
      const outcome = await commitQuestionEffect(c, firm.firmDatabase, idempotency, async () => {
        const marking = await setMeetingQuestionAnswered(
          firm.firmDatabase,
          meetingId as MeetingId,
          questionId as MeetingQuestionId,
          answered,
          questionOptions(c),
        );
        changed = marking.changed;
        const before = await questionBefore(
          c,
          firm.firmDatabase,
          meetingId as MeetingId,
          questionId as MeetingQuestionId,
        );
        return { question: before, responseCode: 200, effect: marking.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(await afterStateChange(c, firm.firmDatabase, meetingId, outcome, changed), 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/questions/{questionId}/redact
  app.openapi(
    { ...redactRoute, middleware: chokepointMiddleware(chokepoint, redactRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, questionId } = c.req.valid("param");
      let changed = false;
      const outcome = await commitQuestionEffect(c, firm.firmDatabase, idempotency, async () => {
        const redaction = await redactMeetingQuestion(
          firm.firmDatabase,
          meetingId as MeetingId,
          questionId as MeetingQuestionId,
          questionOptions(c),
        );
        changed = redaction.redacted;
        const before = await questionBefore(
          c,
          firm.firmDatabase,
          meetingId as MeetingId,
          questionId as MeetingQuestionId,
        );
        return { question: before, responseCode: 200, effect: redaction.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(await afterStateChange(c, firm.firmDatabase, meetingId, outcome, changed), 200);
    },
  );
}

/**
 * The question read back after an upvote or its withdrawal, and — when this request moved the count —
 * the count handed to the room's per-second bucket. The instant is taken BEFORE the read, so a read
 * that started later has seen every commit an earlier one saw and the room can keep the latest.
 */
async function afterUpvoteChange(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  database: BatchDatabase,
  meetingId: string,
  outcome: { readonly questionId: string; readonly executed: boolean },
  changed: boolean,
): Promise<MeetingQuestionEntry> {
  const readAt = new Date().toISOString();
  const question = await questionOnTheRecord(
    database,
    meetingId as MeetingId,
    outcome.questionId,
    requireChokepointUserId(c),
  );
  if (outcome.executed && changed) {
    await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).questionUpvoted(
      question.id,
      question.upvotes,
      readAt,
    );
  }
  return question;
}

/**
 * The question read back after it was marked, unmarked or taken back, and — when this request moved
 * it — its new state whole to the room. A redacted question's copy carries the empty body the record
 * holds.
 */
async function afterStateChange(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  database: BatchDatabase,
  meetingId: string,
  outcome: { readonly questionId: string; readonly executed: boolean },
  changed: boolean,
): Promise<MeetingQuestionEntry> {
  const question = await questionOnTheRecord(
    database,
    meetingId as MeetingId,
    outcome.questionId,
    requireChokepointUserId(c),
  );
  if (outcome.executed && changed) {
    await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).questionUpdated(
      snapshotOf(question),
    );
  }
  return question;
}

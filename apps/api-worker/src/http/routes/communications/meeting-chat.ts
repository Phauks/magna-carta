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
import type { FileId, MeetingId, MeetingMessageId } from "@magna-carta/identifiers/types";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import {
  postMeetingMessage,
  redactMeetingMessage,
  REDACT_MESSAGE_GUARD,
} from "@magna-carta/meetings/chat-service";
import {
  listMeetingMessages,
  listMeetingMessagesRedactedSince,
  readMeetingMessage,
} from "@magna-carta/meetings/chat-statements";
import {
  MAX_MEETING_MESSAGE_LENGTH,
  MAX_MEETING_MESSAGE_PAGE_SIZE,
  MEETING_PARTICIPANT_KINDS,
} from "@magna-carta/meetings/chat-types";
import { MeetingMessageFile } from "@magna-carta/meetings/chat-contract";
import { MeetingChatValidationError } from "@magna-carta/meetings/chat-validation";
import { readMeeting } from "@magna-carta/meetings/meeting-statements";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointPermissions,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
// THE ROOM'S OWN REFUSALS, mapped where the meetings routes map them rather than a second time here.
// One refusal for every way a room is out of reach is a rule that only holds if every door in the
// family gives the same answer, and two copies of the switch are two places for that to stop being
// true.
import { chatErrorResponse } from "./meeting-chat-refusals.ts";
import { meetingErrorResponse, meetingRoomFor } from "./meetings.ts";
import { assertPermission } from "@magna-carta/access-control/registry";

// The in-meeting chat's HTTP surface: say something in a room, read the transcript, take something
// back.
//
// THIS IS THE ONE PLACE THE MEETING SUBSYSTEM STORES CONTENT. Everything else it serves is
// identifiers and instants — the audio, the video and the screen share are routed between browsers
// and never reach this platform. Chat is kept on the record, so a message here carries what a filed
// message carries: it is retained under the matter, it is personal data, and it can be taken back in
// a way that leaves the taking-back on the record.
//
// THE ROUTE IS THE RECORD, AND IT STAYS THE RECORD. The room relays a `message` frame so a message
// reaches the other browsers as it is said rather than on a poller's next tick — but that frame is a
// copy of a row this route has already committed, and a browser that misses one is caught up by the
// read below. A write that went through the socket instead would put the firm's record in a Durable
// Object's transient storage, which empties when the room does.
//
// THE RELAY HAPPENS AFTER THE COMMIT AND CARRIES WHAT THE RECORD NOW HOLDS — the row read back, not
// what the service composed — on the `participantLeft` / `end` precedent the hosting routes follow:
// nobody is shown a message by a write that then failed, and nobody is shown a different message
// from the one the transcript will hand them a second later. A room nobody holds a socket on is a
// no-op, which is most redactions and every message typed into a meeting one person is sitting in.
//
// ONE REFUSAL FOR EVERY WAY A ROOM IS OUT OF REACH, exactly as the meetings routes hold it: an
// unknown meeting handle and a meeting on a matter the member may not see are both 404, because a
// meeting is reachable only through its calendar event. A message in another meeting is 404 for the
// same reason one level down.

const JOIN = "meetings:join" as const;
const HOST = "meetings:host" as const;

// ---- request/response contracts ----

const SendMessageRequest = z
  .object({
    // Bounded here as well as in the domain package and on the row, so a body past the ceiling is
    // refused before it is read rather than after. The domain trims the edges before measuring, so
    // this bound is deliberately generous by the whitespace a browser's Enter key leaves behind.
    // May be empty only beside a file, when the line says the file's name; the domain refuses an
    // empty line with nothing shared.
    body: z.string().max(MAX_MEETING_MESSAGE_LENGTH + 64),
    // One of the meeting's matter's files, shared with the line.
    attachedFileId: z.string().regex(identifierPattern("file")).nullable().optional(),
  })
  .openapi("SendMeetingMessageRequest");

export const MeetingMessage = z
  .object({
    id: z.string(),
    meetingId: z.string(),
    // The STAY it was said from, which is who said it at the time, as a kind and a handle. Two
    // kinds because there are two stay tables: a firm member's attendance row, and the guest stay
    // an external participant holds on a signed link.
    participantKind: z.enum(MEETING_PARTICIPANT_KINDS),
    participantId: z.string(),
    // The firm member behind that stay, resolved through it rather than stored beside it. Null for
    // a guest's message, which has no firm member behind it at all.
    userId: z.string().nullable(),
    sentAt: z.string(),
    // Empty exactly when the message has been taken back, which is what the pair below says.
    body: z.string(),
    redactedAt: z.string().nullable(),
    redactedByUserId: z.string().nullable(),
    // A file shared with the line, by its handle and its name now. Null on an ordinary line, once
    // the line is taken back, and once the file is deleted.
    attachedFile: MeetingMessageFile.nullable(),
  })
  .openapi("MeetingMessage");

/**
 * One message taken back since the caller last read — the handle, and when.
 *
 * The body is already empty on the row and on any copy a client is holding; what this carries is the
 * news that the copy is stale and the instant to put beside it.
 */
const RedactedMeetingMessage = z
  .object({ id: z.string(), redactedAt: z.string() })
  .openapi("RedactedMeetingMessage");

// A TRANSCRIPT PAGE HAS A SECOND LIST, and it is the half a forward walk structurally cannot carry.
//
// `data` is ordered by `(sent_at, id)` and a poller continues from the last of them, which is right
// for what was SAID and blind to what was UNSAID: taking a message back moves no row's position in
// that ordering, so a message already handed to a browser is redacted somewhere the poller will
// never look again. The room relays `message-redacted` to a browser with a socket open; this is what
// catches up the one that reconnected or missed the frame, and the two agree because both carry the
// instant off the same row.
//
// It is populated only for a caller that says where it read to (`since`), because a first page needs
// no convergence — every body on it is already whatever the record now holds — and it may repeat a
// redaction on a later poll, which costs a client nothing: blanking a body that is already blank is
// the same act twice.
export const MeetingMessagePage = paginated(MeetingMessage)
  .extend({ redacted: z.array(RedactedMeetingMessage) })
  .openapi("MeetingMessagePage");

// WHAT A POLLER CARRIES IS A POSITION, NOT A WATERMARK. `since` is the instant it read to and
// `sinceId` is the handle of the row it read there, and the pair is compared as one `(sent_at, id)`
// key. An instant on its own is not a position in this list: two messages can be stamped the same
// millisecond, and a strict "after this instant" then drops the second of them for that poller
// permanently, because the next tick asks from a later instant still. `since` alone is still
// accepted — it is what a caller built against an older shape sends — and keeps the strict-instant
// comparison, which can re-read but never skip.
//
// Both are the caller's to send, and both are safe to derive: two instants compare the same in every
// zone on earth, which is why this one may be derived where the meetings list's `today` may not.
export const listMessagesQuery = cursorQuery.extend({
  since: z.string().datetime().optional(),
  sinceId: z.string().optional(),
});

const meetingIdParam = z.object({ meetingId: identifierPathParam("meeting", "meetingId") });
const messageParams = z.object({
  meetingId: identifierPathParam("meeting", "meetingId"),
  messageId: identifierPathParam("meetingMessage", "messageId"),
});

const commonErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "No meeting — or no message in it — this member can reach at that address",
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
      "The meeting has ended, the caller is not in it, or a request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The message is empty, or longer than a message may be",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// ---- route metas ----

// BOTH ROUTES RIDE meetings:join, not a chat key of their own. Being able to be in the room is what
// chat is: a member who may join may speak, and a member who may not join cannot reach the meeting
// at all. A third permission would be a second answer to the same question, and the one act that
// genuinely needs more — moderating somebody else's words — asks for `meetings:host` inside the
// handler rather than on the route, because the AUTHOR may do it without holding it.
function readMeta(action: string): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission: JOIN,
    // The firm, for the reason both meeting keys bind it: a meeting hangs from a calendar event and
    // a firm event belongs to no matter at all. The matter question is still asked — every read
    // composes the visible-matter predicate through the meeting.
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(action: string): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission: JOIN,
    resource: "firm",
    audited: true,
    // Required. A retried send must not say the same thing twice: the transcript is the record of a
    // conversation, and a duplicated line is a record of something that did not happen.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---- routes ----

const sendRoute = defineOpenAPIRoute(writeMeta("sendMessage"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/messages",
  description:
    "Says something in a meeting's chat, and keeps it on the record. Requires an open stay — being " +
    "in the room is what makes a message sayable, so a member who has left is answered as one who " +
    "is not in the meeting. The message is stored against that stay rather than against the " +
    "member, so somebody who dropped off and dialled back in has each message attributed to the " +
    "stay it was said from. A retried send is answered with the message's record — its handle, its " +
    "stay and its instant — and an empty body: what was said is kept in the transcript, which is " +
    "the one copy a taking-back can reach, and never in the retry record.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SendMessageRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The message is on the record",
      content: { "application/json": { schema: MeetingMessage } },
    },
    ...writeErrors,
  },
});

const listRoute = defineOpenAPIRoute(readMeta("listMessages"), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/messages",
  description:
    "A meeting's chat, oldest first — a conversation is read forwards, so the first page is the " +
    "beginning of the meeting rather than the end of it. A poller following a live meeting " +
    "continues from `nextCursor`, which every page with rows carries whether or not more are " +
    "waiting; here it is a position in the conversation rather than a has-more flag, so a reader " +
    "resumes exactly where it stopped and a caller walking to the end sees one final empty page. " +
    "Never continue from a timestamp alone: two messages can share an instant, and the second is " +
    "lost to a reader that asks for what came strictly after it. `since` with `sinceId` is the " +
    "same position spelled out for a caller that holds the pair rather than the cursor. A message " +
    "that has been taken back is still returned, with an empty body beside the instant and the " +
    "member that say it was removed. A caller that sends `since` also receives `redacted`: the " +
    "messages taken back since that instant, which a forward walk cannot reach because a " +
    "redaction moves no row's position in the ordering. Blank the body of each one you are " +
    "holding; a repeat is harmless.",
  request: { params: meetingIdParam, query: listMessagesQuery },
  responses: {
    200: {
      description: "One page of this meeting's chat",
      content: { "application/json": { schema: MeetingMessagePage } },
    },
    ...commonErrors,
  },
});

const redactRoute = defineOpenAPIRoute(writeMeta("redactMessage"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/messages/{messageId}/redact",
  description:
    "Takes a message back: the body is blanked and the row is kept, so the transcript says a " +
    "message was there and that somebody removed it. The author may do this to their own words and " +
    "a member holding meetings:host may do it to anybody's; a message already taken back answers " +
    "200 unchanged rather than moving the instant already on the record. Still available after the " +
    "meeting has ended — the words outlive the gathering.",
  request: { params: messageParams, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The message has been taken back",
      content: { "application/json": { schema: MeetingMessage } },
    },
    ...writeErrors,
  },
});

// ---- refusals ----

function notFound(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "meeting-not-found",
    title: "Not found",
    status: 404,
    detail: "No such meeting in this firm.",
  });
}

// ---- helpers ----

function serviceOptions(c: Context<{ Bindings: Bindings; Variables: AppVariables }>) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
    // The same predicate every calendar source composes, so a message cannot be posted into — or
    // taken out of — a room a list read could not reach.
    visibility: visibleMatterPredicate(),
    // ASKED HERE RATHER THAN ON THE ROUTE, because the author may take back their own words without
    // holding it. A route gated on meetings:host would refuse the member the redaction exists for.
    mayHost: requireChokepointPermissions(c).has(assertPermission(HOST)),
  };
}

type ChatOutcome =
  | { ok: true; messageId: string }
  | {
      ok: false;
      problem:
        | ProblemResponse<403>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

/**
 * Runs one chat write through the idempotency gate, mapping both refusal vocabularies on the way
 * out: the room's (reaching the meeting at all) and the chat's (the message inside it).
 *
 * THE STORED BODY CARRIES THE MESSAGE'S RECORD AND NOT ITS WORDS, and that is a confidentiality
 * rule rather than a shape preference. `idempotency_key.response_body` is served verbatim to
 * whoever retries the key — by the chokepoint's own gate, before this handler runs again — and
 * nothing a redaction does reaches it. Storing what was said there would leave the words in a second
 * place, outliving the taking-back that was meant to remove them and handed to the next retry of
 * that key; packages/data-access/src/idempotency-statements.ts says the same of every stored body.
 * So the record's own fields are stored — the handle, the stay, the instant — with the words left
 * out, and the retry is answered in the shape it would have been either way. The words are in the
 * transcript, which is the one place they live and the one place a redaction can reach.
 *
 * A FIRST ANSWER IS READ BACK OFF THE ROW rather than projected from what the service composed, so
 * what a member is told is what the record now holds.
 *
 * A REDACTION THAT LOST A RACE IS A SUCCESS, not a fault. The redaction's write is guarded on the
 * message not already being taken back, so two members redacting the same message together leave one
 * of them with a batch that matched no row. What that member asked for is true — the message is
 * gone — and the caller reads the settled row exactly as the ordinary already-redacted path does, so
 * the race answers 200 like the sequence does rather than handing somebody an Error ID for it.
 */
export async function commitChatEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  call: () => Promise<{
    message: z.infer<typeof MeetingMessage>;
    responseCode: number;
    effect: EffectWrite;
  }>,
): Promise<ChatOutcome> {
  // Kept from inside the effect because the guard refusal below is raised by the COMMIT, one level
  // past the callback that knows which message this was about.
  let composed: { messageId: string } | undefined;
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { message, responseCode, effect } = await call();
        composed = { messageId: message.id };
        return {
          write: effect,
          responseCode,
          responseBody: canonicalJsonStringify({ ...message, body: WORDS_NOT_REPLAYED }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof MeetingChatValidationError) {
      return { ok: false, problem: chatErrorResponse(c, caught) };
    }
    if (caught instanceof MeetingValidationError) {
      return { ok: false, problem: meetingErrorResponse(c, caught) };
    }
    if (
      caught instanceof GuardedWriteRefusedError &&
      caught.guard === REDACT_MESSAGE_GUARD &&
      composed !== undefined
    ) {
      return { ok: true, messageId: composed.messageId };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const stored = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return { ok: true, messageId: stored.id };
}

// What a retried write is answered with in place of the words. Empty rather than a marker, because
// the field means "what this message says as the record holds it for this reader", and a retry is
// not entitled to a second copy of content the transcript already carries — the read is one request
// away and is the only surface a redaction reaches.
const WORDS_NOT_REPLAYED = "";

/**
 * The message as the record now holds it, which is what every answer on this surface is built from.
 *
 * Read after the write rather than projected from what the service composed: the row is the record,
 * and a replayed request has no composed value at all. A handle that answers nothing here is not a
 * caller's mistake — the write it came from has committed — so it is a fault with an Error ID rather
 * than a 404 that would tell a member their own message is not there.
 */
export async function messageOnTheRecord(
  database: BatchDatabase,
  meetingId: MeetingId,
  messageId: string,
): Promise<z.infer<typeof MeetingMessage>> {
  const row = await readMeetingMessage(database, meetingId, messageId as MeetingMessageId);
  if (row === undefined) {
    throw new Error(
      `meeting chat: message ${messageId} committed in meeting ${meetingId} could not be read back`,
    );
  }
  return row;
}

// ---- registration ----

export function registerMeetingChatRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/meetings/{meetingId}/messages
  app.openapi(
    { ...sendRoute, middleware: chokepointMiddleware(chokepoint, sendRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const { body, attachedFileId } = c.req.valid("json");

      const outcome = await commitChatEffect(c, firm.firmDatabase, idempotency, async () => {
        const sent = await postMeetingMessage(
          firm.firmDatabase,
          meetingId as MeetingId,
          { body, attachedFileId: (attachedFileId ?? null) as FileId | null },
          serviceOptions(c),
        );
        return { message: sent.message, responseCode: 201, effect: sent.effect };
      });
      if (!outcome.ok) return outcome.problem;
      const message = await messageOnTheRecord(
        firm.firmDatabase,
        meetingId as MeetingId,
        outcome.messageId,
      );
      // The whole record, as the list route would hand it over — so a browser applies the frame and
      // the read with one code path, and the two can never disagree about a field name.
      await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).messageSent(message);
      return c.json(message, 201);
    },
  );

  // GET /api/v1/meetings/{meetingId}/messages
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId } = c.req.valid("param");
      // Through the meeting read FIRST, so the transcript of a room behind a matter the caller may
      // not see is as absent as the room itself. That read is where the walled-matter question is
      // answered; nothing in the chat re-states it.
      const meeting = await readMeeting(
        firm.firmDatabase,
        meetingId as MeetingId,
        visibleMatterPredicate(),
      );
      if (meeting === undefined) return notFound(c);

      const { cursor, since, sinceId } = c.req.valid("query");
      const found = await listMeetingMessages(firm.firmDatabase, meetingId as MeetingId, {
        cursor: decodeCursor(cursor),
        limit: MAX_MEETING_MESSAGE_PAGE_SIZE,
        since,
        sinceId,
      });
      // The convergence half, and only for a caller that says where it read to: a first page already
      // carries whatever the record now holds, so there is nothing behind it to reconcile.
      const redacted =
        since === undefined
          ? []
          : await listMeetingMessagesRedactedSince(
              firm.firmDatabase,
              meetingId as MeetingId,
              since,
              MAX_MEETING_MESSAGE_PAGE_SIZE,
            );
      // The read asks for one row past the page, and that row is the answer to "is there more"
      // rather than part of the page.
      const hasMore = found.length > MAX_MEETING_MESSAGE_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_MEETING_MESSAGE_PAGE_SIZE) : found;
      const last = rows.at(-1);
      return c.json(
        {
          // The domain entry IS the wire shape here, so this list projects nothing; the copy is
          // only to hand the framework a mutable array.
          data: [...rows],
          // A POSITION, NOT A HAS-MORE FLAG — the one list on this API where the last page still
          // carries one, and the reason is who reads this list. A transcript is FOLLOWED: a screen
          // watching a live meeting reaches the end of it and then keeps asking, and a null here
          // would leave it to continue from the last instant it saw — which loses the second of two
          // messages stamped the same millisecond, permanently, because the next ask starts later
          // still. Keyed on the same pair the list is ordered by, so a walk cannot skip or repeat
          // either; a caller walking to the end sees one final empty page instead of stopping a
          // page early.
          nextCursor: last === undefined ? null : encodeCursor(last.sentAt, last.id),
          redacted: [...redacted],
        },
        200,
      );
    },
  );

  // POST /api/v1/meetings/{meetingId}/messages/{messageId}/redact
  app.openapi(
    { ...redactRoute, middleware: chokepointMiddleware(chokepoint, redactRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, messageId } = c.req.valid("param");

      const outcome = await commitChatEffect(c, firm.firmDatabase, idempotency, async () => {
        const taken = await redactMeetingMessage(
          firm.firmDatabase,
          meetingId as MeetingId,
          messageId as MeetingMessageId,
          serviceOptions(c),
        );
        // A message already taken back answers with the row as it stands: the member asked for it
        // to be gone and it is gone, so a refusal would report a failure that did not happen.
        return { message: taken.message, responseCode: 200, effect: taken.effect };
      });
      if (!outcome.ok) return outcome.problem;
      const message = await messageOnTheRecord(
        firm.firmDatabase,
        meetingId as MeetingId,
        outcome.messageId,
      );
      // The handle and the instant alone: the record's body is already blank, and what every
      // browser holds is a copy to blank in its turn. Read off the settled row rather than off the
      // clock, so a redaction that lost a race relays the instant the record actually kept.
      if (message.redactedAt !== null) {
        await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).messageRedacted(
          message.id,
          message.redactedAt,
        );
      }
      return c.json(message, 200);
    },
  );
}

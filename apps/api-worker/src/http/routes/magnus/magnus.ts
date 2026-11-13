import { z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  decodeCompositeCursor,
  decodeCursor,
  encodeCompositeCursor,
  encodeCursor,
} from "@magna-carta/data-access/cursor-pagination";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  FileId,
  MagnusConversationId,
  MagnusTurnId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { primaryReasoningModelDefinition } from "@magna-carta/inference/settings";
import {
  memberAcknowledgedAudit,
  conversationReadByAdministratorAudit,
} from "@magna-carta/magnus/audit";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  attachConversationFile,
  deleteConversation,
  detachConversationFile,
  moveConversation,
  renameConversation,
  startConversation,
} from "@magna-carta/magnus/conversation";
import {
  Availability,
  ConversationPermissionName,
  ConversationSummary,
  SubmitTurnRequest,
  SubmittedTurn,
  TurnDetail,
  TurnProgress,
} from "@magna-carta/magnus/contract";
import { MAGNUS_DISCLOSURE_VERSION } from "@magna-carta/magnus/disclosure";
import {
  CONVERSATION_ATTACHMENTS_MAX,
  MEMBER_TURN_MAX_BYTES,
  exceedsMemberTurnCap,
} from "@magna-carta/magnus/limits";
import { listConversationPermissions } from "@magna-carta/magnus/permissions";
import { magnusDailyTurnCeilingDefinition } from "@magna-carta/magnus/settings";
import { readShelf } from "@magna-carta/magnus/shelf";
import {
  countMemberTurnsSince,
  listAttachmentsWithFiles,
  listConversations,
  listTurns,
  readAttachableFile,
  readConversation,
  readMoveTarget,
  readNextSequence,
  recordAcknowledgementStatement,
} from "@magna-carta/magnus/statements";
import { submitTurn } from "@magna-carta/magnus/turn";
import {
  ATTACHMENT_TEXT_STATUSES,
  CONVERSATION_SORTS,
  type ConversationSort,
} from "@magna-carta/magnus/types";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
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
import { identifierField } from "@magna-carta/identifiers/field";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { resolveMagnusConsent } from "../../../magnus/consent.ts";
import { magnusSubscribeRequest } from "../../../magnus/magnus-sockets.ts";
import {
  answeringModelBody,
  chooseableModelIds,
  modelChoiceRefusal,
  resolveModelChoice,
} from "../../../magnus/model-choice.ts";
import { resolveTurnProgress } from "../../../magnus/turn-progress.ts";
import { acceptTurn, utcDayStart } from "./turn-submission.ts";
import { isWebSocketUpgrade } from "../../../progress/job-progress-sockets.ts";
import {
  DEFAULT_PAGE_SIZE,
  READ_ALL_PERMISSION,
  commonErrors,
  consentRefusal,
  conversationBody,
  turnBody,
  firmGateRefusal,
  mutationMeta,
  notFound,
  readMeta,
  requireOwnConversation,
  requireReadableConversation,
  type MagnusApp,
} from "./route-shared.ts";

// The Magnus surface: start a conversation, submit a turn, watch the answer arrive, read and delete
// the record afterwards.
//
// EVERY route here refuses when the firm has not opted in — before a conversation is created, before
// a turn is enqueued, and before any read. The refusal names WHICH gate is closed by its own problem
// type, because "the firm has not consented to model processing at all" and "the firm has not turned
// this feature on" are different things to fix, and a generic 403 makes a firm administrator guess.
//
// A member reads their own conversations under magnus:converse. Reading somebody else's is a
// SEPARATE permission and a separate branch that writes its own audit row: the read is legitimate
// supervision, and it is exactly the kind of access that should leave a trace.

// ---------------------------------------------------------------------------------------------
// Wire shapes

// A file attached to a conversation by reference, as a reader meets it: the file's own name, and what
// became of its text on the most recent question. `name` is null where the file has been deleted
// since it was attached — stated rather than hidden, because the member may still remember attaching
// it.
const ConversationAttachment = z
  .object({
    fileId: z.string(),
    name: z.string().nullable(),
    matterId: z.string().nullable(),
    attachedAt: z.string(),
    textStatus: z.enum(ATTACHMENT_TEXT_STATUSES as [string, ...string[]]),
    textBytes: z.number().nullable(),
  })
  .openapi("MagnusConversationAttachment");

const AcknowledgementResponse = z
  .object({ disclosureVersion: z.number(), acknowledgedAt: z.string() })
  .openapi("MagnusAcknowledgement");

const conversationIdParam = z.object({
  conversationId: identifierPathParam("magnusConversation", "conversationId"),
});
const attachmentParams = z.object({
  conversationId: identifierPathParam("magnusConversation", "conversationId"),
  fileId: identifierPathParam("file", "fileId"),
});
const turnIdParams = z.object({
  conversationId: identifierPathParam("magnusConversation", "conversationId"),
  turnId: identifierPathParam("magnusTurn", "turnId"),
});

// ---------------------------------------------------------------------------------------------
// Routes

const availabilityRoute = defineOpenAPIRoute(readMeta("availability"), {
  method: "get",
  path: "/api/v1/magnus/availability",
  description:
    "Whether the assistant can be used in this firm right now, and if not, which of the three " +
    "conditions is unmet: the firm has not consented to third-party model processing, the firm has " +
    "not enabled the assistant, or this member has not yet accepted the current disclosure. When " +
    "open, carries the disclosure version in force and how many turns of the firm's daily allowance " +
    "remain. This is what a client calls before showing an input box.",
  responses: {
    200: {
      description: "The resolved availability for this member in this firm",
      content: { "application/json": { schema: Availability } },
    },
    ...commonErrors,
  },
});

const acknowledgeRoute = defineOpenAPIRoute(mutationMeta("acknowledge", true), {
  method: "post",
  path: "/api/v1/magnus/acknowledgement",
  description:
    "Records that this member has been shown, and accepted, the current disclosure. Idempotent: " +
    "accepting the same version again is a no-op that still answers 200. The stored version is what " +
    "makes a later change to what the assistant can see or do re-prompt every member automatically.",
  request: { headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The acknowledgement on record for this member",
      content: { "application/json": { schema: AcknowledgementResponse } },
    },
    ...commonErrors,
  },
});

const startConversationRoute = defineOpenAPIRoute(mutationMeta("startConversation", true), {
  method: "post",
  path: "/api/v1/magnus/conversations",
  description:
    "Starts a conversation. The optional matter link scopes the RECORD, not the request: it says " +
    "which matter's file this transcript belongs to, and puts none of that matter's content into " +
    "anything the assistant is sent. The optional title is the member's own label; the assistant " +
    "never writes one.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              title: z.string().max(CONVERSATION_TITLE_MAX_LENGTH).nullish(),
              matterId: identifierField("matter").nullish(),
            })
            .openapi("MagnusStartConversationRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The conversation was started",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    ...commonErrors,
  },
});

const listConversationsRoute = defineOpenAPIRoute(readMeta("listConversations"), {
  method: "get",
  path: "/api/v1/magnus/conversations",
  description:
    "The caller's own conversations, in the order `sort` names: `date` (newest first, the default), " +
    "`name` (by the member's own title, with unnamed conversations after the named ones, ordered by " +
    "when they started), or `matter` (grouped by the matter they are kept on, by its title, with " +
    "conversations on no matter last). The order is applied to the whole record and the cursor " +
    "pages within it. A member holding the read-all-conversations permission may pass `scope=firm` " +
    "to list every member's instead; that read is audited. The optional matter filter narrows the " +
    "page to the conversations kept on one matter's file, which is what a matter's own assistant " +
    "surface reads; it narrows the RECORD and says nothing about what any of those conversations " +
    "was built from. `search` narrows to the conversations a term reaches: on the caller's own " +
    "conversations it matches the title and what was said in them, and on `scope=firm` it matches " +
    "titles alone — one member searching their own work is not the same act as reading across the " +
    "firm's transcripts, and only the first is what this offers. Each row carries where the CALLER " +
    "keeps it (`folderId`, null for General, and `pinnedAt`); `folder` narrows to one of the " +
    "caller's folders or to `general`, and `pinned=true` to what the caller has pinned.",
  request: {
    query: cursorQuery.extend({
      scope: z.enum(["own", "firm"]).optional(),
      matterId: identifierField("matter").optional(),
      search: z.string().max(200).optional(),
      sort: z.enum(CONVERSATION_SORTS as [ConversationSort, ...ConversationSort[]]).optional(),
      // The caller's own shelf: one folder, General ("general"), or what they have pinned.
      folder: z.union([z.literal("general"), identifierField("magnusFolder")]).optional(),
      pinned: z.enum(["true"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of conversations",
      content: {
        "application/json": {
          schema: paginated(ConversationSummary).openapi("MagnusConversationPage"),
        },
      },
    },
    ...commonErrors,
  },
});

const getConversationRoute = defineOpenAPIRoute(readMeta("getConversation"), {
  method: "get",
  path: "/api/v1/magnus/conversations/{conversationId}",
  description:
    "One conversation with a page of its turns, newest first. A member reads their own; reading " +
    "another member's requires the read-all-conversations permission and writes an audit row.",
  request: { params: conversationIdParam, query: cursorQuery },
  responses: {
    200: {
      description: "The conversation and one page of its turns",
      content: {
        "application/json": {
          schema: z
            .object({
              conversation: ConversationSummary,
              turns: paginated(TurnDetail),
              attachments: z.array(ConversationAttachment),
              // What Magnus may read beyond the conversation, as its author set it.
              permissions: z.array(ConversationPermissionName),
            })
            .openapi("MagnusConversationDetail"),
        },
      },
    },
    ...commonErrors,
  },
});

const renameConversationRoute = defineOpenAPIRoute(mutationMeta("renameConversation", true), {
  method: "patch",
  path: "/api/v1/magnus/conversations/{conversationId}",
  description:
    "Renames a conversation. The title is member-supplied only — nothing generates one — and a null " +
    "title returns the conversation to displaying by its start instant.",
  request: {
    params: conversationIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ title: z.string().max(CONVERSATION_TITLE_MAX_LENGTH).nullable() })
            .openapi("MagnusRenameConversationRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The conversation was renamed",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    ...commonErrors,
  },
});

const moveConversationRoute = defineOpenAPIRoute(mutationMeta("moveConversation", true), {
  method: "patch",
  path: "/api/v1/magnus/conversations/{conversationId}/matter",
  description:
    "Keeps a conversation on another matter's file, or on none. Which matter a transcript is kept " +
    "on is what decides who may read it, so this is an access decision as much as a filing one, " +
    "and the audit row names both matters. The caller must be able to read the conversation (their " +
    "own, or anyone's under the read-all-conversations permission) and the target matter must be " +
    "one the firm still writes to: a closed matter and the platform's own matters are refused. The " +
    "conversation's attachments go with the move, because each is one of the OLD matter's files. " +
    "The link still scopes only the record: nothing of the matter's content reaches the assistant.",
  request: {
    params: conversationIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ matterId: identifierField("matter").nullable() })
            .openapi("MagnusMoveConversationRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The conversation is now kept where the request said",
      content: { "application/json": { schema: ConversationSummary } },
    },
    ...commonErrors,
    422: {
      description: "The target matter is closed, is the platform's own, or does not exist",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const attachFileRoute = defineOpenAPIRoute(mutationMeta("attachFile", true), {
  method: "post",
  path: "/api/v1/magnus/conversations/{conversationId}/attachments",
  description:
    "Attaches one of the conversation's matter's files to the conversation, BY REFERENCE. The " +
    "attachment copies nothing: on each later question, the file's current version is read, its " +
    "readable text is taken through the platform's own extraction, and that text is sent ahead of " +
    "the question under a heading naming the file, within a bounded budget. A conversation kept on " +
    `no matter can attach nothing, because files are matter-rooted. At most ${CONVERSATION_ATTACHMENTS_MAX} per conversation.`,
  request: {
    params: conversationIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z.object({ fileId: identifierField("file") }).openapi("MagnusAttachFileRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The file is attached; the conversation's attachments after the write",
      content: { "application/json": { schema: z.array(ConversationAttachment) } },
    },
    ...commonErrors,
    422: {
      description:
        "The conversation is on no matter, the file is not one of that matter's, or the " +
        "conversation already carries as many files as it may",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const detachFileRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("detachFile", true),
    // Nothing of the file was copied, so putting it back is attaching it again.
    reversal: { kind: "inverse", by: "magnus.attachFile" },
  },
  {
    method: "delete",
    path: "/api/v1/magnus/conversations/{conversationId}/attachments/{fileId}",
    description:
      "Takes a file off the conversation. Nothing of the file was ever copied, so nothing is erased; " +
      "later questions simply travel without it.",
    request: { params: attachmentParams, headers: idempotencyKeyHeader },
    responses: {
      200: {
        description:
          "The file is no longer attached; the conversation's attachments after the write",
        content: { "application/json": { schema: z.array(ConversationAttachment) } },
      },
      ...commonErrors,
    },
  },
);

const deleteConversationRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("deleteConversation", true),
    reversal: {
      kind: "none",
      reason:
        "This is the erasure instrument for everything typed into the assistant: the turns go wholesale, and the audited record is that a conversation existed and was deleted, never what was in it.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/magnus/conversations/{conversationId}",
    description:
      "Deletes a conversation and every turn in it. The audited record is that a conversation existed " +
      "and was deleted — never what was in it. This is the erasure instrument for everything typed " +
      "into the assistant: the text goes wholesale rather than column by column.",
    request: { params: conversationIdParam, headers: idempotencyKeyHeader },
    responses: {
      200: {
        description: "The conversation and its turns were deleted",
        content: { "application/json": { schema: z.object({ id: z.string() }) } },
      },
      ...commonErrors,
    },
  },
);

const submitTurnRoute = defineOpenAPIRoute(mutationMeta("submitTurn", true), {
  method: "post",
  path: "/api/v1/magnus/conversations/{conversationId}/turns",
  description:
    `Submits a message and returns immediately with a pending answer to poll or subscribe to. The ` +
    `message is capped at ${MEMBER_TURN_MAX_BYTES} bytes; a larger one is refused naming the limit ` +
    `rather than being silently truncated or sent on. The firm's daily turn allowance is checked ` +
    `before anything is enqueued.`,
  request: {
    params: conversationIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: SubmitTurnRequest,
        },
      },
      required: true,
    },
  },
  responses: {
    202: {
      description: "The message was recorded and an answer is pending",
      content: {
        "application/json": {
          schema: SubmittedTurn,
        },
      },
    },
    ...commonErrors,
    422: {
      description:
        "The message exceeds the per-turn size limit, or names a model or effort it cannot",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded, or the firm's daily turn allowance is spent",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const getTurnRoute = defineOpenAPIRoute(readMeta("getTurn"), {
  method: "get",
  path: "/api/v1/magnus/conversations/{conversationId}/turns/{turnId}",
  description:
    "The current state of one turn: pending, complete with its content, or settled with a closed " +
    "failure label. This is the polling fallback for the events subscription beside it, and returns " +
    "byte-identical state to what that subscription pushes.",
  request: { params: turnIdParams },
  responses: {
    200: {
      description: "The turn's current state",
      content: { "application/json": { schema: TurnProgress } },
    },
    ...commonErrors,
  },
});

const eventsRoute = defineOpenAPIRoute(readMeta("events"), {
  method: "get",
  path: "/api/v1/magnus/conversations/{conversationId}/events",
  description:
    "Subscribes to a conversation over a WebSocket. The server sends the newest turn's state on " +
    'connect and again on every transition; each frame is { "type": "state", "protocolVersion": 1, ' +
    '"state": { … } } where state is the same object the turn poll endpoint returns. The client may ' +
    'send { "type": "resync" } to be re-sent the current state and { "type": "ping" } for a ' +
    "keepalive. A settled turn is pushed once and the socket then closes. Requires an " +
    "Upgrade: websocket request; the poll endpoint is the equivalent answer for a client that " +
    "cannot upgrade.",
  request: { params: conversationIdParam },
  responses: {
    101: { description: "The subscription is open; turn state follows as WebSocket frames" },
    ...commonErrors,
    426: {
      description: "The request did not ask to upgrade to a WebSocket",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// ---------------------------------------------------------------------------------------------
// Handlers

export function registerMagnusRoutes(app: MagnusApp, chokepoint: Chokepoint): void {
  // Availability — what a client calls before showing an input box.
  app.openapi(
    { ...availabilityRoute, middleware: chokepointMiddleware(chokepoint, availabilityRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      if (consent.state !== "open") {
        return c.json(
          {
            state: consent.state,
            ...(consent.state === "acknowledgement-required" && {
              disclosureVersion: consent.disclosureVersion,
            }),
          },
          200,
        );
      }
      const [ceiling, spent, modelId] = await Promise.all([
        readFirmSetting(firm.firmDatabase, magnusDailyTurnCeilingDefinition),
        countMemberTurnsSince(firm.firmDatabase, utcDayStart(new Date().toISOString())),
        readFirmSetting(firm.firmDatabase, primaryReasoningModelDefinition),
      ]);
      // The firm's model, read through the same setting the consumer reads, so what the composer
      // offers first and what the queue sends when the member chooses nothing are the same model.
      return c.json(
        {
          state: "open" as const,
          disclosureVersion: consent.disclosureVersion,
          remainingDailyTurns: Math.max(ceiling - spent, 0),
          model: answeringModelBody(modelId),
          models: chooseableModelIds().flatMap((id) => answeringModelBody(id) ?? []),
        },
        200,
      );
    },
  );

  // Acknowledgement — recorded against the version the member was shown.
  app.openapi(
    { ...acknowledgeRoute, middleware: chokepointMiddleware(chokepoint, acknowledgeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      // The FIRM gates still bind: a member cannot pre-accept a disclosure for a firm that has not
      // opted in. The acknowledgement state itself obviously does not gate the acknowledgement.
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const firmRefusal = firmGateRefusal(c, consent);
      if (firmRefusal !== null) return firmRefusal;

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const acknowledgedAt = now();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: {
            statements: [
              recordAcknowledgementStatement(firm.firmDatabase, {
                userId,
                disclosureVersion: MAGNUS_DISCLOSURE_VERSION,
                now: acknowledgedAt,
              }),
              memberAcknowledgedAudit(
                firm.firmDatabase,
                { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
                { userId, disclosureVersion: MAGNUS_DISCLOSURE_VERSION },
              ),
            ],
            outboxMessages: [],
          },
          responseCode: 200,
          responseBody: canonicalJsonStringify({
            disclosureVersion: MAGNUS_DISCLOSURE_VERSION,
            acknowledgedAt,
          }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as {
          disclosureVersion: number;
          acknowledgedAt: string;
        },
        200,
      );
    },
  );

  // Start a conversation.
  app.openapi(
    {
      ...startConversationRoute,
      middleware: chokepointMiddleware(chokepoint, startConversationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const { title, matterId } = c.req.valid("json");
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const started = startConversation(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            { title: title ?? null, createdBy: userId, matterId: matterId ?? null },
          );
          return {
            write: started.effect,
            responseCode: 201,
            responseBody: canonicalJsonStringify({ id: started.conversationId }),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      return c.json(JSON.parse(result.responseBody ?? "{}") as { id: string }, 201);
    },
  );

  // List conversations.
  app.openapi(
    {
      ...listConversationsRoute,
      middleware: chokepointMiddleware(chokepoint, listConversationsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const {
        cursor,
        scope,
        matterId,
        search,
        sort: requestedSort,
        folder,
        pinned,
      } = c.req.valid("query");
      const sort = requestedSort ?? "date";
      // The firm-wide scope is a separate grant. Without it a member sees exactly their own, which is
      // the default and needs no opt-in.
      if (scope === "firm" && !requireChokepointPermissions(c).has(READ_ALL_PERMISSION)) {
        return problemJson(c, {
          type: "permission-denied",
          status: 403,
          title: "Permission denied",
          detail: "Your role does not grant this action in this firm.",
          requestAccess: true,
        });
      }

      // The cursor's shape follows the order: the date order pages on the ordinary (created_at, id)
      // pair, the two grouped orders on a composite whose primary is the group's sort key. Decoding
      // the wrong shape yields undefined, which reads as the first page rather than a wrong one.
      const decodedCursor = sort === "date" ? decodeCursor(cursor) : decodeCompositeCursor(cursor);
      const rows = await listConversations(firm.firmDatabase, {
        ...(scope === "firm" ? {} : { createdBy: userId }),
        ...(matterId !== undefined && { matterId }),
        ...(search !== undefined && { search }),
        sort,
        ...(decodedCursor !== undefined && { cursor: decodedCursor }),
        limit: DEFAULT_PAGE_SIZE + 1,
        shelfMember: userId,
        ...(folder !== undefined && { folder }),
        ...(pinned === "true" && { pinnedOnly: true }),
      });
      const page = rows.slice(0, DEFAULT_PAGE_SIZE);
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > DEFAULT_PAGE_SIZE && last !== undefined
          ? sort === "date"
            ? encodeCursor(last.createdAt, last.id)
            : encodeCompositeCursor(last.sortKey, last.createdAt, last.id)
          : null;
      return c.json(
        {
          data: page.map((row) => conversationBody(row, row)),
          nextCursor,
        },
        200,
      );
    },
  );

  // One conversation with a page of its turns.
  app.openapi(
    { ...getConversationRoute, middleware: chokepointMiddleware(chokepoint, getConversationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const { conversationId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const conversation = await readConversation(firm.firmDatabase, conversationId);
      if (conversation === undefined || conversation.state === "deleted") {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Conversation not found",
        });
      }

      // Somebody else's conversation is reachable only under the administrative permission, and that
      // read leaves a trace.
      if (conversation.createdBy !== userId) {
        if (!requireChokepointPermissions(c).has(READ_ALL_PERMISSION)) {
          return problemJson(c, {
            type: "not-found",
            status: 404,
            title: "Conversation not found",
          });
        }
        const now = () => new Date().toISOString();
        await commitEffectBatch(
          firm.firmDatabase,
          {
            statements: [
              conversationReadByAdministratorAudit(
                firm.firmDatabase,
                { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
                { conversationId, authorUserId: conversation.createdBy },
              ),
            ],
            outboxMessages: [],
          },
          { now },
        );
      }

      const [turns, attachments, shelf, permissions] = await Promise.all([
        listTurns(firm.firmDatabase, conversationId, {
          ...(decodeCursor(cursor) !== undefined && { cursor: decodeCursor(cursor) }),
          limit: DEFAULT_PAGE_SIZE + 1,
        }),
        listAttachmentsWithFiles(firm.firmDatabase, conversationId),
        readShelf(firm.firmDatabase, conversationId, userId),
        listConversationPermissions(firm.firmDatabase, conversationId),
      ]);
      const page = turns.slice(0, DEFAULT_PAGE_SIZE);
      const last = page[page.length - 1];
      return c.json(
        {
          conversation: conversationBody(conversation, shelf),
          attachments: attachments.map(attachmentBody),
          permissions: [...permissions],
          turns: {
            data: page.map((turn) => turnBody(turn, conversation.createdBy === userId)),
            nextCursor:
              turns.length > DEFAULT_PAGE_SIZE && last !== undefined
                ? encodeCursor(last.createdAt, last.id)
                : null,
          },
        },
        200,
      );
    },
  );

  // Rename.
  app.openapi(
    {
      ...renameConversationRoute,
      middleware: chokepointMiddleware(chokepoint, renameConversationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const { conversationId } = c.req.valid("param");
      const { title } = c.req.valid("json");
      const owned = await requireOwnConversation(c, conversationId, userId);
      if (owned === null) return notFound(c);

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: renameConversation(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            { conversationId, title },
          ),
          responseCode: 200,
          responseBody: canonicalJsonStringify({ id: conversationId }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      return c.json({ id: conversationId }, 200);
    },
  );

  // Move: keep the conversation on another matter, or on none.
  app.openapi(
    {
      ...moveConversationRoute,
      middleware: chokepointMiddleware(chokepoint, moveConversationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const { conversationId } = c.req.valid("param");
      const { matterId } = c.req.valid("json");
      // A conversation the caller can READ may be moved: their own, or anyone's under the
      // administrative permission. Somebody else's is absent to a caller without it.
      const readable = await requireReadableConversation(c, conversationId, userId);
      if (readable === null) return notFound(c);
      const conversation = await readConversation(firm.firmDatabase, conversationId);
      if (conversation === undefined) return notFound(c);

      // The target has to be a matter the firm still writes to. A closed matter takes no new
      // work, and the platform's own matters are not a place a member keeps any.
      if (matterId !== null) {
        const target = await readMoveTarget(firm.firmDatabase, matterId as MatterId);
        if (target === undefined || target.systemOwned) {
          return problemJson(c, {
            type: "validation",
            title: "That matter cannot hold a conversation",
            status: 422,
            detail: "The matter does not exist in this firm, or is not one a member works on.",
          });
        }
        if (target.status === "closed") {
          return problemJson(c, {
            type: "validation",
            title: "That matter is closed",
            status: 422,
            detail: "A closed matter takes no new work. Reopen it first, or choose another.",
          });
        }
      }

      const attachments = await listAttachmentsWithFiles(firm.firmDatabase, conversationId);
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: moveConversation(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            {
              conversationId,
              fromMatterId: conversation.matterId,
              toMatterId: matterId === null ? null : (matterId as MatterId),
              attachmentCount: attachments.length,
            },
          ),
          responseCode: 200,
          responseBody: canonicalJsonStringify({ id: conversationId }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      const [moved, shelf] = await Promise.all([
        readConversation(firm.firmDatabase, conversationId),
        readShelf(firm.firmDatabase, conversationId, userId),
      ]);
      if (moved === undefined) return notFound(c);
      return c.json(conversationBody(moved, shelf), 200);
    },
  );

  // Attach one of the matter's files, by reference.
  app.openapi(
    { ...attachFileRoute, middleware: chokepointMiddleware(chokepoint, attachFileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const { conversationId } = c.req.valid("param");
      const { fileId } = c.req.valid("json");
      const owned = await requireOwnConversation(c, conversationId, userId);
      if (owned === null) return notFound(c);
      const conversation = await readConversation(firm.firmDatabase, conversationId);
      if (conversation === undefined) return notFound(c);

      // Files are matter-rooted, so the conversation has to be on a matter, and the file has to be
      // that matter's. Either failure is stated: a picker offers only the matter's own files, so a
      // request that names another's is a stale picker or a hand-made request, and both deserve
      // the reason rather than a bare refusal.
      if (conversation.matterId === null) {
        return problemJson(c, {
          type: "validation",
          title: "This conversation is kept on no matter",
          status: 422,
          detail: "Files belong to a matter. Keep the conversation on a matter first.",
        });
      }
      const file = await readAttachableFile(firm.firmDatabase, fileId as FileId);
      if (file === undefined || file.matterId !== conversation.matterId) {
        return problemJson(c, {
          type: "validation",
          title: "That file is not one of this matter's",
          status: 422,
          detail: "Only a file kept on the conversation's own matter can be attached.",
        });
      }
      const existing = await listAttachmentsWithFiles(firm.firmDatabase, conversationId);
      const alreadyAttached = existing.some((attachment) => attachment.fileId === fileId);
      if (!alreadyAttached && existing.length >= CONVERSATION_ATTACHMENTS_MAX) {
        return problemJson(c, {
          type: "validation",
          title: "This conversation carries as many files as it may",
          status: 422,
          detail: `A conversation carries at most ${CONVERSATION_ATTACHMENTS_MAX} files. Take one off first.`,
        });
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: attachConversationFile(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            { conversationId, fileId: fileId as FileId },
          ),
          responseCode: 201,
          responseBody: canonicalJsonStringify({ fileId }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      const attachments = await listAttachmentsWithFiles(firm.firmDatabase, conversationId);
      return c.json(attachments.map(attachmentBody), 201);
    },
  );

  // Detach.
  app.openapi(
    { ...detachFileRoute, middleware: chokepointMiddleware(chokepoint, detachFileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const { conversationId, fileId } = c.req.valid("param");
      const owned = await requireOwnConversation(c, conversationId, userId);
      if (owned === null) return notFound(c);

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: detachConversationFile(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            { conversationId, fileId: fileId as FileId },
          ),
          responseCode: 200,
          responseBody: canonicalJsonStringify({ fileId }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      const attachments = await listAttachmentsWithFiles(firm.firmDatabase, conversationId);
      return c.json(attachments.map(attachmentBody), 200);
    },
  );

  // Delete.
  app.openapi(
    {
      ...deleteConversationRoute,
      middleware: chokepointMiddleware(chokepoint, deleteConversationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const { conversationId } = c.req.valid("param");
      const owned = await requireOwnConversation(c, conversationId, userId);
      if (owned === null) return notFound(c);

      const existingTurns = await listTurns(firm.firmDatabase, conversationId, {
        limit: DEFAULT_PAGE_SIZE,
      });
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: deleteConversation(
            firm.firmDatabase,
            { clock: { now }, actorUserId: userId, randomSource: cryptoRandomSource },
            { conversationId, turnCount: existingTurns.length },
          ),
          responseCode: 200,
          responseBody: canonicalJsonStringify({ id: conversationId }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      return c.json({ id: conversationId }, 200);
    },
  );

  // Submit a turn — the full gate chain, then one atomic batch, then a pending answer.
  app.openapi(
    { ...submitTurnRoute, middleware: chokepointMiddleware(chokepoint, submitTurnRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const { conversationId } = c.req.valid("param");
      const { content, modelId, effort } = c.req.valid("json");
      const owned = await requireOwnConversation(c, conversationId, userId);
      if (owned === null) return notFound(c);
      return acceptTurn(c, { firm, userId, conversationId, content, modelId, effort });
    },
  );

  // Poll one turn.
  app.openapi(
    { ...getTurnRoute, middleware: chokepointMiddleware(chokepoint, getTurnRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      const { conversationId, turnId } = c.req.valid("param");
      const readable = await requireReadableConversation(c, conversationId, userId);
      if (readable === null) return notFound(c);

      return c.json(
        await resolveTurnProgress(
          firm.firmDatabase,
          conversationId as MagnusConversationId,
          turnId as MagnusTurnId,
        ),
        200,
      );
    },
  );

  // Subscribe. The upgrade traverses the chokepoint like any other route; the object is addressed by
  // the SESSION firm id and the request forwarded inward is built from server-derived values only.
  app.openapi(
    { ...eventsRoute, middleware: chokepointMiddleware(chokepoint, eventsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      // The consent gates are read BEFORE the upgrade shape is checked: a firm that has not opted in
      // gets the same refusal here as on every other route, rather than learning that this endpoint
      // would have talked to it if only it had asked correctly.
      const consent = await resolveMagnusConsent(firm.firmDatabase, userId);
      const refusal = consentRefusal(c, consent);
      if (refusal !== null) return refusal;

      if (!isWebSocketUpgrade(c.req.raw)) {
        return problemJson(c, {
          type: "websocket-upgrade-required",
          status: 426,
          title: "WebSocket upgrade required",
          detail:
            "This endpoint serves WebSocket subscriptions. Send Upgrade: websocket, or poll the " +
            "turn endpoint instead.",
        });
      }

      const { conversationId } = c.req.valid("param");
      const readable = await requireReadableConversation(c, conversationId, userId);
      if (readable === null) return notFound(c);

      const conversation = c.env.MAGNUS_CONVERSATION.get(
        c.env.MAGNUS_CONVERSATION.idFromName(`${firmId}:${conversationId}`),
      );
      return conversation.fetch(magnusSubscribeRequest(firmId, conversationId));
    },
  );
}

// An attachment on the wire: the reference and its outcome, never the file's bytes or text.
function attachmentBody(attachment: {
  readonly fileId: string;
  readonly fileName: string | null;
  readonly fileMatterId: string | null;
  readonly attachedAt: string;
  readonly textStatus: string;
  readonly textBytes: number | null;
}) {
  return {
    fileId: attachment.fileId,
    name: attachment.fileName,
    matterId: attachment.fileMatterId,
    attachedAt: attachment.attachedAt,
    textStatus: attachment.textStatus,
    textBytes: attachment.textBytes,
  };
}

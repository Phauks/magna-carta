import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  FirmId,
  MatterTaskId,
  MeetingId,
  MeetingRecordingId,
  MeetingSummaryActionItemId,
  UserId,
} from "@magna-carta/identifiers/types";
import { readMeeting } from "@magna-carta/meetings/meeting-statements";
import {
  readRecording,
  readRecordingFilingFacts,
} from "@magna-carta/meetings/recording-statements";
import type { MeetingRecordingRow } from "@magna-carta/meetings/recording-types";
import {
  actionItemTaskStatements,
  beginSummaryStatements,
  rerunSummaryEffect,
  SUMMARY_ACTION_ITEM_TASK_GUARD,
  SUMMARY_RERUN_GUARD,
  summaryReadAuditStatement,
} from "@magna-carta/meetings/summary-service";
import {
  isSummaryPerTranscriptConflict,
  listSummaryActionItems,
  readSummaryActionItem,
  readSummaryForTranscript,
  type MeetingSummaryActionItemListRow,
} from "@magna-carta/meetings/summary-statements";
import {
  MEETING_SUMMARY_REFUSAL_REASONS,
  MEETING_SUMMARY_STATES,
  toSummaryHeader,
  type MeetingSummaryRow,
} from "@magna-carta/meetings/summary-types";
import { readTranscriptForRecording } from "@magna-carta/meetings/transcript-statements";
import {
  MEETING_TRANSCRIPT_WITHHELD_REASONS,
  type MeetingTranscriptRow,
  type MeetingTranscriptWithheldReason,
} from "@magna-carta/meetings/transcript-types";
import { createMatterTask } from "@magna-carta/tasks/task-service";
import { MAX_TASK_TITLE_LENGTH } from "@magna-carta/tasks/types";
import { TaskValidationError } from "@magna-carta/tasks/validation";
import type { Permission } from "@magna-carta/access-control/registry";
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
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import type { MeetingSummaryMessage } from "../../../meetings/meeting-recorder.ts";
import {
  SUMMARY_CLAIM_LEASE_MILLISECONDS,
  sendSummaryRun,
  transcriptWordsWithheld,
} from "../../../meetings/summary-consumer.ts";
import { taskErrorResponse } from "../shared/task-error-response.ts";

// A RECORDED MEETING'S SUMMARY: read it with its action items, ask for it to be written again, and turn
// an action item into a task.
//
// A SUMMARY HAS NO VISIBILITY RULE OF ITS OWN. It is reached through its transcript, which is reached
// through its recording, which is reached through its meeting, which is read through the visible-matter
// predicate — exactly as the transcript's read is — so a summary of a recording on a walled matter is as
// absent as the meeting, and every way it is out of reach is the one 404.
//
// ITS WORDS FOLLOW THE TRANSCRIPT'S DOCUMENT. The summary is derived from the transcript's lines, and the
// lines are served only while the transcript's filed version exists, is not in the trash and is not held
// by the scan; the summary's text and action items are withheld on exactly the same reading, with the
// same reasons. Every read that serves its text is audited, naming identifiers and never a sentence.
//
// AN ACTION ITEM BECOMES A TASK THROUGH THE TASK SUBSYSTEM'S OWN CREATE PATH — `createMatterTask`, with its
// validation, its audit row and its assignment notice — composed into one batch with the mark on the item,
// so a task exists exactly when the item names it. There is no second way to make a task here.

const JOIN = "meetings:join" as const;
const HOST = "meetings:host" as const;
const TASKS_WRITE = "tasks:write" as const;
const TASKS_ASSIGN = "tasks:assign" as const;

// ---- request/response contracts ----

const MeetingSummaryHeaderSchema = z
  .object({
    id: z.string(),
    transcriptId: z.string(),
    recordingId: z.string(),
    // `pending` while a model writes it, `ready`, `failed` (with an Error ID; a member holding
    // meetings:host may run it again), or `refused` (with its reason).
    state: z.enum(MEETING_SUMMARY_STATES),
    // Why a refused summary was not written: `disabled` (the firm has not switched summaries on),
    // `not-eligible` (the firm's chosen reasoning model is a third-party one, and the firm has not
    // allowed its content to reach one), `transcript-empty` (nobody was heard). Null otherwise.
    refusalReason: z.enum(MEETING_SUMMARY_REFUSAL_REASONS).nullable(),
    // The Error ID the standard pipeline recorded when it failed — a handle, never a message.
    failureErrorId: z.string().nullable(),
    // The model that wrote it, or that the firm's choice named for a refusal about that model.
    modelId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("MeetingSummaryHeader");

const MeetingSummaryActionItemOwnerSchema = z
  .object({ userId: z.string(), displayName: z.string() })
  .openapi("MeetingSummaryActionItemOwner");

const MeetingSummaryActionItemSchema = z
  .object({
    id: z.string(),
    // Its place in the summary's list, from zero.
    ordinal: z.number().int().min(0),
    text: z.string(),
    // The member who undertook it — named only where the model gave EXACTLY the name the transcript
    // knows them by — with their name as it reads now; null when nobody could be named with certainty.
    owner: z.union([MeetingSummaryActionItemOwnerSchema, z.null()]),
    // The civil date it is due, only where the transcript itself stated one.
    dueOn: z.string().nullable(),
    // The task a member made of it; null until somebody does.
    taskId: z.string().nullable(),
  })
  .openapi("MeetingSummaryActionItem");

// THE SUMMARY AS A SCREEN PAINTS IT. `text` and `actionItems` are present only for a `ready` summary whose
// transcript's filed document can still be opened; otherwise `text` is null and the list empty, and
// `withheld` says why when it is the document — `removed` (in the trash), `held` (by the scan) or
// `unavailable` (gone, or moved behind a wall). `withheld` is null whenever the words are not withheld,
// including a summary that has none yet.
const MeetingSummaryViewSchema = z
  .object({
    summary: MeetingSummaryHeaderSchema,
    text: z.string().nullable(),
    actionItems: z.array(MeetingSummaryActionItemSchema),
    withheld: z.enum(MEETING_TRANSCRIPT_WITHHELD_REASONS).nullable(),
  })
  .openapi("MeetingSummaryView");

const CreateActionItemTaskRequest = z
  .object({
    // Whether the task is put in the action item's owner's name. On by default; off makes the task
    // unassigned. Putting it in another member's name needs the task-assign permission, as creating
    // any task for somebody else does.
    assignToOwner: z.boolean().default(true),
  })
  .openapi("CreateMeetingActionItemTaskRequest");

const CreatedActionItemTaskSchema = z
  .object({
    taskId: z.string(),
    actionItem: MeetingSummaryActionItemSchema,
  })
  .openapi("CreatedMeetingActionItemTask");

const recordingParams = z.object({
  meetingId: identifierPathParam("meeting", "meetingId"),
  recordingId: identifierPathParam("meetingRecording", "recordingId"),
});

const actionItemParams = recordingParams.extend({
  actionItemId: identifierPathParam("meetingSummaryActionItem", "actionItemId"),
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
    description:
      "No meeting, recording, transcript or summary this member can reach at that address",
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
      "The transcript is not ready, the summary is not ready or its words are withheld, the action " +
      "item is already a task, or a request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The task the action item would become is not one the task subsystem accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// ---- route metas ----

// `resource: "firm"` for the reason every meeting key binds the firm: a meeting hangs from a calendar
// event, and the matter question is asked through the meeting read rather than by the chokepoint.
const summaryReadMeta: RouteMeta = {
  operationId: "meetings.recordingSummary",
  surface: "app",
  authenticated: true,
  permission: JOIN,
  resource: "firm",
  // AUDITED, as the transcript's read is: the summary is a characterization of the same words.
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

function writeMeta(action: string, permission: typeof HOST | typeof TASKS_WRITE): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: true,
    // Required. A retried re-run must not start a second run, and a retried Create task must not put
    // a second copy of one obligation on somebody's list.
    idempotency: "required",
    idempotencyStore: "firm",
    // The record keeps a POINTER (the summary's or the task's handle), never the reply: the reply
    // carries derived content — an action item's text — which has no place in the idempotency table,
    // and is answered from the record as it stands now. A path fingerprint makes the handler's own
    // `runIdempotentEffect` the replay decision, and the handler answers a replay by reading afresh,
    // where the default gate would hand the retry the stored pointer verbatim as if it were the reply.
    idempotencyFingerprint: "path",
    rateLimit: "default",
  };
}

// ---- routes ----

const readSummaryRoute = defineOpenAPIRoute(summaryReadMeta, {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/recordings/{recordingId}/summary",
  description:
    "The summary of one recording's transcript: where it stands and, once it is ready, its text and " +
    "its action items in order — each with the member who undertook it where the model named them " +
    "exactly, the date it is due where the transcript stated one, and the task made of it. The words " +
    "are served only while the transcript's filed document exists, is not in the trash and is not " +
    "held by the scan; otherwise withheld says why. Every read of the words is audited, naming " +
    "identifiers and never a sentence. A recording with no summary, a recording in another meeting, " +
    "and a meeting the member cannot reach are all not found.",
  request: { params: recordingParams },
  responses: {
    200: {
      description: "The summary",
      content: { "application/json": { schema: MeetingSummaryViewSchema } },
    },
    ...commonErrors,
  },
});

const rerunSummaryRoute = defineOpenAPIRoute(writeMeta("rerunSummary", HOST), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/recordings/{recordingId}/summary",
  description:
    "Asks for the summary of a recording's ready transcript to be written again — or written for the " +
    "first time, where the transcript has none. A summary already being written is left to finish, " +
    "and asking again sends it on if it was stranded. The firm's settings are read when it is run: a " +
    "firm that has not switched summaries on, or whose chosen model it has not allowed its content " +
    "to reach, is answered with a refused summary rather than an error. Writing it again replaces the " +
    "text and the action items; a task already made of an action item is kept. A transcript whose " +
    "filed document is in the trash, held by the scan or gone is not read again. A retry with the " +
    "same Idempotency-Key is answered with the summary as it stands now.",
  request: { params: recordingParams, headers: idempotencyKeyHeader },
  responses: {
    202: {
      description: "The summary is being written",
      content: { "application/json": { schema: MeetingSummaryViewSchema } },
    },
    ...writeErrors,
  },
});

const createActionItemTaskRoute = defineOpenAPIRoute(
  writeMeta("createSummaryActionItemTask", TASKS_WRITE),
  {
    method: "post",
    path: "/api/v1/meetings/{meetingId}/recordings/{recordingId}/summary/action-items/{actionItemId}/task",
    description:
      "Makes a task of one action item of a ready summary, through the task subsystem's own create " +
      "path: on the recording's matter, titled with the item, due on the date the transcript stated " +
      "(read in the meeting's own time zone), and — unless assignToOwner is false — in the owner's " +
      "name. Needs the task-write permission and the meeting-join permission; putting it in another " +
      "member's name needs the task-assign permission too. An item is made a task once; a retry with " +
      "the same Idempotency-Key is answered with the task the first request made.",
    request: {
      params: actionItemParams,
      headers: idempotencyKeyHeader,
      body: {
        content: { "application/json": { schema: CreateActionItemTaskRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The task, and the action item now naming it",
        content: { "application/json": { schema: CreatedActionItemTaskSchema } },
      },
      ...writeErrors,
    },
  },
);

// ---- helpers ----

function notFound(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "meeting-not-found",
    title: "Not found",
    status: 404,
    detail: "No such meeting, recording or summary in this firm.",
  });
}

function transcriptNotReady(c: Context): ProblemResponse<409> {
  return problemJson(c, {
    type: "meeting-transcript-not-ready",
    title: "The transcript is not ready",
    status: 409,
    detail: "A summary is written from a ready transcript, and this recording's is not ready yet.",
  });
}

function summaryNotReady(c: Context): ProblemResponse<409> {
  return problemJson(c, {
    type: "meeting-summary-not-ready",
    title: "The summary is not ready",
    status: 409,
    detail:
      "This summary is still being written, was not written, or its transcript's document can no " +
      "longer be opened.",
  });
}

/** What a request reached, through the gate: the meeting's recording and its transcript. */
interface Reached {
  readonly recording: MeetingRecordingRow;
  readonly transcript: MeetingTranscriptRow | undefined;
}

/**
 * THROUGH THE MEETING FIRST, then the recording within it, then its transcript — so a summary of a
 * recording on a walled matter, or of a recording in another room, is as absent as one that names nothing.
 */
async function reach(
  database: BatchDatabase,
  meetingId: string,
  recordingId: string,
): Promise<Reached | undefined> {
  const meeting = await readMeeting(database, meetingId as MeetingId, visibleMatterPredicate());
  if (meeting === undefined) return undefined;
  const recording = await readRecording(
    database,
    meetingId as MeetingId,
    recordingId as MeetingRecordingId,
  );
  if (recording === undefined) return undefined;
  return { recording, transcript: await readTranscriptForRecording(database, recording.id) };
}

function actionItemEntry(
  row: MeetingSummaryActionItemListRow,
): z.infer<typeof MeetingSummaryActionItemSchema> {
  return {
    id: row.id,
    ordinal: row.ordinal,
    text: row.text,
    owner:
      row.owner_user_id === null
        ? null
        : { userId: row.owner_user_id, displayName: row.owner_display_name ?? "" },
    dueOn: row.due_on,
    taskId: row.task_id,
  };
}

/**
 * Whether a summary's words may be served: they are the transcript's, characterized, so they follow the
 * transcript's filed document. Null when they may.
 */
async function summaryWithheld(
  database: BatchDatabase,
  transcript: MeetingTranscriptRow,
): Promise<MeetingTranscriptWithheldReason | null> {
  return await transcriptWordsWithheld(database, transcript);
}

function transcriptWithheld(
  c: Context,
  reason: MeetingTranscriptWithheldReason,
): ProblemResponse<409> {
  return problemJson(c, {
    type: "meeting-summary-not-ready",
    title: "The transcript's document cannot be opened",
    status: 409,
    detail:
      `A summary is written from a transcript whose filed document can be opened, and this one's is ` +
      `${reason === "removed" ? "in the trash" : reason === "held" ? "held by the scan" : "no longer available"}.`,
  });
}

/** The view of a summary without its words — what a write answers, and a summary with none yet. */
function headerOnly(summary: MeetingSummaryRow): z.infer<typeof MeetingSummaryViewSchema> {
  return { summary: toSummaryHeader(summary), text: null, actionItems: [], withheld: null };
}

function summaryMessage(
  firmId: FirmId,
  recording: MeetingRecordingRow,
  summary: Pick<MeetingSummaryRow, "id" | "transcript_id">,
): MeetingSummaryMessage {
  return {
    kind: "meeting-summary",
    firmId,
    meetingId: recording.meeting_id,
    recordingId: recording.id,
    transcriptId: summary.transcript_id,
    summaryId: summary.id,
  };
}

/**
 * A task title from an action item: the item whole when it fits, otherwise cut with the whole as body.
 * The cut is made between characters, never inside one: the task's limit is counted in UTF-16 units, and a
 * cut at a unit count can split a character outside the basic plane in two, leaving half of it.
 */
export function taskTitleAndBody(text: string): {
  readonly title: string;
  readonly body: string | null;
} {
  if (text.length <= MAX_TASK_TITLE_LENGTH) return { title: text, body: null };
  const ellipsis = "…";
  let title = "";
  for (const character of text) {
    if (title.length + character.length + ellipsis.length > MAX_TASK_TITLE_LENGTH) break;
    title += character;
  }
  return { title: `${title.trimEnd()}${ellipsis}`, body: text };
}

/** The action item names a task already, found by the effect before it writes anything. */
class ActionItemAlreadyTaskedError extends Error {}

export function registerMeetingSummaryRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/meetings/{meetingId}/recordings/{recordingId}/summary
  app.openapi(
    { ...readSummaryRoute, middleware: chokepointMiddleware(chokepoint, readSummaryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId, recordingId } = c.req.valid("param");
      const reached = await reach(firm.firmDatabase, meetingId, recordingId);
      if (reached?.transcript === undefined) return notFound(c);
      const summary = await readSummaryForTranscript(firm.firmDatabase, reached.transcript.id);
      if (summary === undefined) return notFound(c);
      if (summary.state !== "ready") return c.json(headerOnly(summary), 200);
      const withheld = await summaryWithheld(firm.firmDatabase, reached.transcript);
      if (withheld !== null) return c.json({ ...headerOnly(summary), withheld }, 200);
      const actionItems = await listSummaryActionItems(firm.firmDatabase, summary.id);
      // The read is recorded before the words leave, as the transcript's is: who, which summary, how
      // many action items — never a sentence or a name.
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            summaryReadAuditStatement(
              firm.firmDatabase,
              {
                summary,
                actorUserId: requireChokepointUserId(c),
                actionItemCount: actionItems.length,
              },
              { clock: { now: () => now }, randomSource: cryptoRandomSource },
            ),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      return c.json(
        {
          summary: toSummaryHeader(summary),
          text: summary.summary_text,
          actionItems: actionItems.map(actionItemEntry),
          withheld: null,
        },
        200,
      );
    },
  );

  // POST /api/v1/meetings/{meetingId}/recordings/{recordingId}/summary
  app.openapi(
    { ...rerunSummaryRoute, middleware: chokepointMiddleware(chokepoint, rerunSummaryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, recordingId } = c.req.valid("param");
      const reached = await reach(firm.firmDatabase, meetingId, recordingId);
      if (reached === undefined) return notFound(c);
      const transcript = reached.transcript;
      if (transcript?.state !== "ready") return transcriptNotReady(c);
      // A host who cannot open the transcript's document cannot ask for its words to be read again —
      // a re-run would destroy the action items they cannot see, and the run itself would refuse.
      const withheld = await summaryWithheld(firm.firmDatabase, transcript);
      if (withheld !== null) return transcriptWithheld(c, withheld);

      const now = () => new Date().toISOString();
      const options = { clock: { now }, randomSource: cryptoRandomSource };
      // What the request decided to send on, once its write has committed.
      let toSend: Pick<MeetingSummaryRow, "id" | "transcript_id"> | null = null;
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const current = await readSummaryForTranscript(firm.firmDatabase, transcript.id);
            let write: EffectWrite = { statements: [], outboxMessages: [] };
            let summaryId: string;
            if (current === undefined) {
              // A transcript ready before summaries existed, or whose begin never reached it.
              const begun = beginSummaryStatements(
                firm.firmDatabase,
                { transcript, requestedByUserId: userId },
                options,
              );
              write = { statements: begun.statements, outboxMessages: [] };
              summaryId = begun.summaryId;
              toSend = { id: begun.summaryId, transcript_id: transcript.id };
            } else if (current.state === "pending") {
              // IDEMPOTENT WHILE ONE IS BEING WRITTEN: nothing is written, and the run is sent on again
              // only when nobody holds it and no retry is waiting on it — a run stranded by a lost
              // message is the case this rescues. A run put off after a model refused is not stranded:
              // its own message is due at `retry_at`, and a second sent now would start a second chain
              // of attempts beside it, each spending again.
              summaryId = current.id;
              const held =
                current.claimed_at !== null &&
                Date.parse(current.claimed_at) + SUMMARY_CLAIM_LEASE_MILLISECONDS > Date.now();
              const waiting =
                current.retry_at !== null && Date.parse(current.retry_at) > Date.now();
              if (!held && !waiting) toSend = current;
            } else {
              write = rerunSummaryEffect(
                firm.firmDatabase,
                { summary: current, actorUserId: userId },
                options,
              );
              summaryId = current.id;
              toSend = current;
            }
            return {
              write,
              responseCode: 202,
              responseBody: canonicalJsonStringify({ id: summaryId }),
            };
          },
        });
      } catch (caught) {
        // Another request started the run between this one's read and its write — the run this member
        // asked for is happening; they are answered with it.
        const raced =
          (caught instanceof GuardedWriteRefusedError && caught.guard === SUMMARY_RERUN_GUARD) ||
          isSummaryPerTranscriptConflict(caught);
        if (!raced) throw caught;
        toSend = null;
        result = { kind: "raced" as const };
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "executed" && toSend !== null) {
        await sendSummaryRun(c.env, summaryMessage(firmId, reached.recording, toSend));
      }
      const summary = await readSummaryForTranscript(firm.firmDatabase, transcript.id);
      if (summary === undefined)
        throw new Error("a summary request committed and none is recorded");
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(headerOnly(summary), 202);
    },
  );

  // POST /api/v1/meetings/{meetingId}/recordings/{recordingId}/summary/action-items/{actionItemId}/task
  app.openapi(
    {
      ...createActionItemTaskRoute,
      middleware: chokepointMiddleware(chokepoint, createActionItemTaskRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const permissions = requireChokepointPermissions(c);
      const { meetingId, recordingId, actionItemId } = c.req.valid("param");
      const { assignToOwner } = c.req.valid("json");
      // THE ITEM IS THE MEETING'S, so reading it needs what reading the meeting needs; the chokepoint
      // asked for the task half, and the meeting half is asked here rather than by splitting the act.
      if (!permissions.has(JOIN as unknown as Permission)) {
        return problemJson(c, {
          type: "permission-denied",
          title: "Forbidden",
          status: 403,
          detail: "Making a task of a meeting's action item needs the meeting-join permission.",
        });
      }
      const reached = await reach(firm.firmDatabase, meetingId, recordingId);
      if (reached?.transcript === undefined) return notFound(c);
      const transcript = reached.transcript;
      const summary = await readSummaryForTranscript(firm.firmDatabase, transcript.id);
      if (summary === undefined) return notFound(c);
      const actionItem = await readSummaryActionItem(
        firm.firmDatabase,
        summary.id,
        actionItemId as MeetingSummaryActionItemId,
      );
      if (actionItem === undefined) return notFound(c);
      if (
        summary.state !== "ready" ||
        (await summaryWithheld(firm.firmDatabase, transcript)) !== null
      ) {
        return summaryNotReady(c);
      }
      const assigneeUserId = assignToOwner ? actionItem.owner_user_id : null;
      if (
        assigneeUserId !== null &&
        assigneeUserId !== userId &&
        !permissions.has(TASKS_ASSIGN as unknown as Permission)
      ) {
        return problemJson(c, {
          type: "permission-denied",
          title: "Forbidden",
          status: 403,
          detail: "Putting a task in another member's name needs the assign permission.",
        });
      }
      const alreadyTasked = (): ProblemResponse<409> =>
        problemJson(c, {
          type: "meeting-summary-action-item-tasked",
          title: "That action item is already a task",
          status: 409,
          detail: "Somebody has already made a task of this action item.",
        });

      // The due date is a civil date read in the meeting's own time zone — the zone the people in the
      // meeting stated it in.
      const facts =
        actionItem.due_on === null
          ? undefined
          : await readRecordingFilingFacts(firm.firmDatabase, reached.recording.id);
      const { title, body } = taskTitleAndBody(actionItem.text);
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            // Asked here, inside the effect, and not before it: a RETRY of the request that made the
            // task finds the item tasked by that very request, and must be answered with the task —
            // the replay is decided before this runs — rather than told somebody else got there.
            if (actionItem.task_id !== null) throw new ActionItemAlreadyTaskedError();
            const created = await createMatterTask(
              firm.firmDatabase,
              {
                matterId: reached.recording.matter_id,
                title,
                body,
                assigneeUserId,
                dueOn: actionItem.due_on,
                timeZone: actionItem.due_on === null ? null : (facts?.timeZone ?? null),
              },
              {
                clock: { now },
                actorUserId: userId as UserId,
                randomSource: cryptoRandomSource,
                visibility: visibleMatterPredicate(),
              },
            );
            return {
              write: {
                statements: [
                  ...created.effect.statements,
                  ...actionItemTaskStatements(
                    firm.firmDatabase,
                    { summary, actionItem, taskId: created.taskId, actorUserId: userId as UserId },
                    { clock: { now }, randomSource: cryptoRandomSource },
                  ),
                ],
                outboxMessages: created.effect.outboxMessages,
              },
              responseCode: 201,
              responseBody: canonicalJsonStringify({ id: created.taskId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TaskValidationError) return taskErrorResponse(c, caught);
        if (caught instanceof ActionItemAlreadyTaskedError) return alreadyTasked();
        // Two presses racing: the other one's task is the item's, and this one's rolled back whole.
        if (
          caught instanceof GuardedWriteRefusedError &&
          caught.guard === SUMMARY_ACTION_ITEM_TASK_GUARD
        ) {
          return alreadyTasked();
        }
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      const stored = JSON.parse(result.responseBody ?? "{}") as { id: MatterTaskId };
      const items = await listSummaryActionItems(firm.firmDatabase, summary.id);
      const itemOnTheRecord = items.find((item) => item.id === actionItem.id);
      if (itemOnTheRecord === undefined) return notFound(c);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json({ taskId: stored.id, actionItem: actionItemEntry(itemOnTheRecord) }, 201);
    },
  );
}

import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { WALL_CLOCK_TIME_PATTERN } from "@magna-carta/civil-time/wall-clock";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { decodeTimelineCursor } from "@magna-carta/calendar/merge";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  FileId,
  MatterId,
  MatterNoteDocumentId,
  MatterNoteId,
} from "@magna-carta/identifiers/types";
import {
  attachFileToMatterNote,
  createMatterNote,
  deleteMatterNote,
  detachFileFromMatterNote,
  editMatterNote,
} from "@magna-carta/notes/note-service";
import {
  readMatterNote,
  readMatterNoteDocuments,
  selectMatterNotesStatement,
  type MatterNoteDocumentRow,
  type MatterNoteRow,
} from "@magna-carta/notes/note-statements";
import { MAX_NOTE_BODY_LENGTH, MAX_NOTE_PAGE_SIZE } from "@magna-carta/notes/types";
import { NoteValidationError } from "@magna-carta/notes/validation";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// The matter note's HTTP surface over @magna-carta/notes.
//
// A note is edited in place and deleted outright, on the owner's direction: replacing a note with
// another note every time somebody fixes a word accumulates without end. So an edit overwrites, and
// a delete removes the row and its words, leaving an audit entry that says a note existed here and
// never what it said.
//
// The one thing this surface still refuses is putting a note's words where a firm-wide surface would
// render them: the federated timeline carries no label for a note, and the text is behind this
// surface's own permission.
//
// Attaching a file links a handle the File Manager already quarantined and stored. Bytes never reach
// a note route, and detaching ends the association without touching the document.

const READ = "notes:read" as const;
const WRITE = "notes:write" as const;

const CIVIL_DATE = CIVIL_DATE_PATTERN;
const WALL_CLOCK_TIME = WALL_CLOCK_TIME_PATTERN;

// ---- request/response contracts ----

// What a note says about when the thing it describes happened, as a caller supplies it. All three
// are optional together, and the shape rules are enforced in the domain rather than here: a time
// needs a date, and a wall-clock time needs the zone it is read in.
const occurrenceFields = {
  occurredOn: z.string().regex(CIVIL_DATE).nullable().optional(),
  occurredAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
  timeZone: z.string().min(1).max(120).nullable().optional(),
};

const CreateNoteRequest = z
  .object({ body: z.string().min(1).max(MAX_NOTE_BODY_LENGTH), ...occurrenceFields })
  .openapi("CreateMatterNoteRequest");

const EditNoteRequest = z
  .object({ body: z.string().min(1).max(MAX_NOTE_BODY_LENGTH), ...occurrenceFields })
  .openapi("EditMatterNoteRequest");

const AttachDocumentRequest = z
  .object({ fileId: identifierField("file") })
  .openapi("AttachMatterNoteDocumentRequest");

const NoteDocument = z
  .object({
    id: z.string(),
    fileId: z.string(),
    // Resolved from the matter's own file record, so a surface names a document the way the File
    // Manager names it rather than keeping a second copy of the name that could drift.
    fileName: z.string(),
    contentType: z.string().nullable(),
    linkedAt: z.string(),
    linkedBy: z.string().nullable(),
  })
  .openapi("MatterNoteDocument");

const NoteDetail = z
  .object({
    id: z.string(),
    matterId: z.string(),
    // Who wrote it. It does not null when they leave the firm, so a surface rendering this resolves
    // the name and whether that member is still active from the member read.
    authorUserId: z.string(),
    body: z.string(),
    // Who last changed the words, where anybody has. Null on a note nobody has edited, which is a
    // different fact from the author having edited their own note.
    lastEditedBy: z.string().nullable(),
    // When the thing the note describes happened, which is not when the note was typed. Null where
    // the note records no single moment.
    occurredOn: z.string().nullable(),
    occurredAtTime: z.string().nullable(),
    timeZone: z.string().nullable(),
    // The matter's files this note points at. Empty where it points at none.
    documents: z.array(NoteDocument),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("MatterNoteDetail");

const NotePage = paginated(NoteDetail).openapi("MatterNotePage");
const CreatedResponse = z.object({ id: z.string() }).openapi("CreatedMatterNote");
const AcknowledgedResponse = z.object({ ok: z.literal(true) }).openapi("MatterNoteAcknowledged");

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const noteIdParam = z.object({ noteId: identifierPathParam("matterNote", "noteId") });
const attachmentIdParam = z.object({
  attachmentId: identifierPathParam("matterNoteDocument", "attachmentId"),
});

// Finding a note again on this matter, matched against its current text. No snippet is emitted and
// none is needed: every row this returns is a note whose body the same reader is already shown.
const listNotesQuery = cursorQuery.extend({ search: z.string().min(1).max(200).optional() });

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the note is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request body is not a shape this operation accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limited",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// ---- error mapping ----

function noteErrorResponse(
  c: Context,
  caught: NoteValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  switch (caught.code) {
    case "note-unknown":
    case "note-unknown-file":
    // 404 and not 403: which matter a note or a document belongs to is itself a fact about the
    // firm's work, and a distinguishable refusal would let a caller probe for either.
    case "note-matter-mismatch":
    case "note-file-matter-mismatch":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Note request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

// ---- route metas ----

function readMeta(action: string): RouteMeta {
  return {
    operationId: `notes.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(action: string): RouteMeta {
  return {
    operationId: `notes.${action}`,
    surface: "app",
    authenticated: true,
    permission: WRITE,
    resource: "matter",
    audited: true,
    // Required. A retried create must not put a second copy of the same note on the matter, and a
    // note is the one record where a duplicate is genuinely confusing later: two identical accounts
    // of one phone call, minutes apart, read as two calls.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---- routes ----

const listNotesRoute = defineOpenAPIRoute(readMeta("listNotes"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/notes",
  description:
    "The matter's notes, most recent first. Ordered by when the thing each note describes " +
    "happened, falling back to the day it was written, so a note about Tuesday's call sits beside " +
    "Tuesday. Each carries the documents it points at. Pass a search term to narrow to the notes " +
    "whose text contains it.",
  request: { params: matterIdParam, query: listNotesQuery },
  responses: {
    200: {
      description: "One page of notes",
      content: { "application/json": { schema: NotePage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const getNoteRoute = defineOpenAPIRoute(readMeta("getNote"), {
  method: "get",
  path: "/api/v1/notes/{noteId}",
  description:
    "One note by its id, with the documents it points at — what a deep link into the matter's " +
    "notes opens, through the same matter visibility the list reads under. A note on a matter the " +
    "member may not see is not found, never partially shown.",
  request: { params: noteIdParam },
  responses: {
    200: {
      description: "The note",
      content: { "application/json": { schema: NoteDetail } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createNoteRoute = defineOpenAPIRoute(writeMeta("createNote"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/notes",
  description:
    "Writes a note on the matter. The note records who wrote it and when. Say separately when the " +
    "thing it describes happened where there is such a moment: a note typed on Thursday about a " +
    "call on Tuesday carries both, and the matter's history places it on the Tuesday.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: { content: { "application/json": { schema: CreateNoteRequest } }, required: true },
  },
  responses: {
    201: { description: "The note", content: { "application/json": { schema: CreatedResponse } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const editNoteRoute = defineOpenAPIRoute(writeMeta("editNote"), {
  method: "patch",
  path: "/api/v1/notes/{noteId}",
  description:
    "Changes a note's text, and when it says the thing happened. The previous text is replaced and " +
    "is not kept: what the note said before is gone. Who made the change is recorded.",
  request: {
    headers: idempotencyKeyHeader,
    params: noteIdParam,
    body: { content: { "application/json": { schema: EditNoteRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The note was changed",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const deleteNoteRoute = defineOpenAPIRoute(
  {
    ...writeMeta("deleteNote"),
    reversal: {
      kind: "none",
      reason:
        "The note and its text are removed outright. Nothing puts a deleted note back — the revision chain and retraction that would replace this delete are designed and not built.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/notes/{noteId}",
    description:
      "Deletes a note. The note and its text are removed and cannot be recovered. Documents the note " +
      "pointed at are untouched and stay in the matter's files: deleting a note has never been a way " +
      "to delete a document.",
    request: { headers: idempotencyKeyHeader, params: noteIdParam },
    responses: {
      200: {
        description: "The note was deleted",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const attachDocumentRoute = defineOpenAPIRoute(writeMeta("attachNoteDocument"), {
  method: "post",
  path: "/api/v1/notes/{noteId}/documents",
  description:
    "Points a note at one of the matter's documents. The document is not copied or moved: it stays " +
    "in the matter's files with everything that follows from being there. Only a document on the " +
    "note's own matter can be attached.",
  request: {
    headers: idempotencyKeyHeader,
    params: noteIdParam,
    body: { content: { "application/json": { schema: AttachDocumentRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The document was attached",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const detachDocumentRoute = defineOpenAPIRoute(
  {
    ...writeMeta("detachNoteDocument"),
    reversal: { kind: "inverse", by: "notes.attachNoteDocument" },
  },
  {
    method: "delete",
    path: "/api/v1/note-documents/{attachmentId}",
    description:
      "Stops a note pointing at a document. The document is untouched and stays in the matter's files.",
    request: { headers: idempotencyKeyHeader, params: attachmentIdParam },
    responses: {
      200: {
        description: "The document was detached",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

// ---- helpers ----

function serviceOptions(userId: string) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as never,
    randomSource: cryptoRandomSource,
    // The same predicate the federated timeline composes, so an id-addressed write cannot reach a
    // note a matter-scoped read could not.
    visibility: visibleMatterPredicate(),
  };
}

function noteDetail(
  row: MatterNoteRow,
  documents: readonly MatterNoteDocumentRow[],
): z.infer<typeof NoteDetail> {
  return {
    id: row.id,
    matterId: row.matter_id,
    authorUserId: row.author_user_id,
    body: row.body,
    lastEditedBy: row.last_edited_by,
    occurredOn: row.occurred_on,
    occurredAtTime: row.occurred_at_time,
    timeZone: row.time_zone,
    documents: documents
      .filter((document) => document.note_id === row.id)
      .map((document) => ({
        id: document.id,
        fileId: document.file_id,
        fileName: document.file_name,
        contentType: document.content_type,
        linkedAt: document.linked_at,
        linkedBy: document.linked_by,
      })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readNotesPage(
  database: SqlDatabase,
  matterId: MatterId,
  cursor: string | undefined,
  search: string | undefined,
): Promise<{ data: z.infer<typeof NoteDetail>[]; nextCursor: string | null }> {
  const decoded = decodeTimelineCursor(cursor);
  const { results } = await selectMatterNotesStatement(database, matterId, {
    cursor: decoded === undefined ? undefined : { sortKey: decoded.sortKey, id: decoded.id },
    limit: MAX_NOTE_PAGE_SIZE + 1,
    visibility: visibleMatterPredicate(),
    search,
  }).all<MatterNoteRow & { ordering_date: string }>();
  const hasMore = results.length > MAX_NOTE_PAGE_SIZE;
  const rows = hasMore ? results.slice(0, MAX_NOTE_PAGE_SIZE) : results;
  const last = rows.at(-1);
  // The page's attachments in ONE bounded read keyed by the notes on it, never one read per note.
  const documents = await readMatterNoteDocuments(
    database,
    rows.map((row) => row.id),
    visibleMatterPredicate(),
  );
  return {
    data: rows.map((row) => noteDetail(row, documents)),
    // Keyed on the same expression the list is ordered by, so the walk cannot skip or repeat.
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.ordering_date, last.id) : null,
  };
}

type NoteEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | { ok: false; problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> };

async function commitNoteEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ id: string; effect: EffectWrite }>,
): Promise<NoteEffectOutcome> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { id, effect } = await call();
        return {
          write: effect,
          responseCode,
          // The stored body IS the wire body: the idempotency gate replays it verbatim.
          responseBody: canonicalJsonStringify({ id }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof NoteValidationError) {
      return { ok: false, problem: noteErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const stored = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return { ok: true, id: stored.id, replayed: result.kind === "replayed" };
}

export function registerNotesRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/matters/{matterId}/notes
  app.openapi(
    { ...listNotesRoute, middleware: chokepointMiddleware(chokepoint, listNotesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { cursor, search } = c.req.valid("query");
      return c.json(await readNotesPage(firm.firmDatabase, matterId, cursor, search), 200);
    },
  );

  // GET /api/v1/notes/{noteId}
  app.openapi(
    { ...getNoteRoute, middleware: chokepointMiddleware(chokepoint, getNoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { noteId } = c.req.valid("param");
      const row = await readMatterNote(
        firm.firmDatabase,
        noteId as MatterNoteId,
        visibleMatterPredicate(),
      );
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such note in this firm.",
        });
      }
      const documents = await readMatterNoteDocuments(
        firm.firmDatabase,
        [row.id],
        visibleMatterPredicate(),
      );
      return c.json(noteDetail(row, documents), 200);
    },
  );

  // POST /api/v1/matters/{matterId}/notes
  app.openapi(
    { ...createNoteRoute, middleware: chokepointMiddleware(chokepoint, createNoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitNoteEffect(c, firm.firmDatabase, idempotency, 201, () => {
        const created = createMatterNote(
          firm.firmDatabase,
          { matterId, ...request },
          serviceOptions(userId),
        );
        return Promise.resolve({ id: created.noteId, effect: created.effect });
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // PATCH /api/v1/notes/{noteId}
  app.openapi(
    { ...editNoteRoute, middleware: chokepointMiddleware(chokepoint, editNoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { noteId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitNoteEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await editMatterNote(
          firm.firmDatabase,
          noteId as MatterNoteId,
          request,
          serviceOptions(userId),
        );
        return { id: noteId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/notes/{noteId}
  app.openapi(
    { ...deleteNoteRoute, middleware: chokepointMiddleware(chokepoint, deleteNoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { noteId } = c.req.valid("param");
      const outcome = await commitNoteEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await deleteMatterNote(
          firm.firmDatabase,
          noteId as MatterNoteId,
          serviceOptions(userId),
        );
        return { id: noteId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/notes/{noteId}/documents
  app.openapi(
    { ...attachDocumentRoute, middleware: chokepointMiddleware(chokepoint, attachDocumentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { noteId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitNoteEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const attached = await attachFileToMatterNote(
          firm.firmDatabase,
          noteId as MatterNoteId,
          request.fileId as FileId,
          serviceOptions(userId),
        );
        return { id: attached.linkId, effect: attached.effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // DELETE /api/v1/note-documents/{attachmentId}
  app.openapi(
    { ...detachDocumentRoute, middleware: chokepointMiddleware(chokepoint, detachDocumentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { attachmentId } = c.req.valid("param");
      const outcome = await commitNoteEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await detachFileFromMatterNote(
          firm.firmDatabase,
          attachmentId as MatterNoteDocumentId,
          serviceOptions(userId),
        );
        return { id: attachmentId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );
}

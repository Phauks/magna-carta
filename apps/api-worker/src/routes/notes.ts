import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { decodeTimelineCursor } from "@magna-carta/calendar/merge";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, MatterNoteId } from "@magna-carta/identifiers/types";
import {
  createMatterNote,
  retractMatterNote,
  reviseMatterNote,
} from "@magna-carta/notes/note-service";
import {
  readMatterNote,
  readMatterNoteDetail,
  readMatterNoteRevisions,
  selectMatterNotesStatement,
  type MatterNoteDisplayRow,
} from "@magna-carta/notes/note-statements";
import {
  MATTER_NOTE_STATES,
  MAX_NOTE_BODY_LENGTH,
  MAX_NOTE_PAGE_SIZE,
  MAX_NOTE_REVISION_PAGE_SIZE,
  MAX_RETRACTION_REASON_LENGTH,
} from "@magna-carta/notes/types";
import { NoteValidationError } from "@magna-carta/notes/validation";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../contracts/common.ts";
import { capped, cursorQuery, paginated } from "../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// The matter note's HTTP surface over @magna-carta/notes: writing down what the firm knows about a
// case that no other record holds, correcting it, and withdrawing it.
//
// Three things this surface never does. It has NO DELETE — not a route, not a verb, not a bulk
// action — because a note is corrected by appending a revision and withdrawn by retraction, and the
// one case where bytes must genuinely leave routes through the erasure residue report and a person.
// It never returns a retracted note's body, on any read, including the history read. And it never
// puts a note's words anywhere a firm-wide surface would render them: the federated timeline carries
// no label for a note, and the note's text is behind this surface's own permission.

const READ = "notes:read" as const;
const WRITE = "notes:write" as const;
const RETRACT = "notes:retract" as const;

// ---- request/response contracts ----

const CreateNoteRequest = z
  .object({
    body: z.string().min(1).max(MAX_NOTE_BODY_LENGTH),
  })
  .openapi("CreateMatterNoteRequest");

const ReviseNoteRequest = z
  .object({
    body: z.string().min(1).max(MAX_NOTE_BODY_LENGTH),
  })
  .openapi("ReviseMatterNoteRequest");

const RetractNoteRequest = z
  .object({
    // Required, and the API says so rather than accepting an empty string and refusing later.
    reason: z.string().min(1).max(MAX_RETRACTION_REASON_LENGTH),
  })
  .openapi("RetractMatterNoteRequest");

const NoteDetail = z
  .object({
    id: z.string(),
    matterId: z.string(),
    // Who wrote the note first. It does not null when they leave the firm — an unattributed
    // contemporaneous record is worth a fraction of an attributed one — so a surface rendering this
    // resolves the name and whether that member is still active from the member read.
    authorUserId: z.string(),
    state: z.enum(MATTER_NOTE_STATES),
    // Null on a retracted note, always. The read itself nulls it rather than trusting each caller to
    // check the state, so a surface that forgets gets nothing to render rather than something it
    // should not have.
    body: z.string().nullable(),
    // How many bodies this note has had. One means it has never been corrected; more is what a
    // surface badges to offer the history.
    revisionCount: z.number().int().positive(),
    // Whoever wrote the body currently showing, which is not always the note's original author.
    currentRevisionAuthorUserId: z.string().nullable(),
    currentRevisionCreatedAt: z.string().nullable(),
    retractedAt: z.string().nullable(),
    retractedBy: z.string().nullable(),
    // Why the words came down. Carried on a retracted note deliberately: retraction is visible, and
    // the reason is what stays in place of the body.
    retractionReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("MatterNoteDetail");

const NoteRevision = z
  .object({
    id: z.string(),
    noteId: z.string(),
    body: z.string(),
    authorUserId: z.string(),
    ordinal: z.number().int().positive(),
    createdAt: z.string(),
  })
  .openapi("MatterNoteRevision");

const NotePage = paginated(NoteDetail).openapi("MatterNotePage");
// A CAPPED answer rather than a paged one: the chain of one note, bounded by
// MAX_NOTE_REVISION_PAGE_SIZE, with `capped` saying when the note has more versions than were
// returned. A chain that long is a corrupted note or an automated writer rather than a lawyer
// fixing typos, but "we stopped counting" and "that is all" must not be the same answer.
const NoteRevisionList = capped(NoteRevision).openapi("MatterNoteRevisionList");

const CreatedResponse = z.object({ id: z.string() }).openapi("CreatedMatterNote");
const AcknowledgedResponse = z.object({ ok: z.literal(true) }).openapi("MatterNoteAcknowledged");

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const noteIdParam = z.object({ noteId: identifierPathParam("matterNote", "noteId") });

// Finding a note again on a matter. Scoped to the one matter the path names and matched against the
// notes' CURRENT text only, so a note corrected to remove a name stops being findable by it. No
// snippet is emitted and none is needed: every row this can return is a note whose body the same
// reader is already shown on the same screen.
const listNotesQuery = cursorQuery.extend({
  search: z.string().min(1).max(200).optional(),
});

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
    description:
      "A request with this Idempotency-Key is still in progress, or the note is withdrawn",
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
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "note-unknown":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "note-matter-mismatch":
      // 404 and not 403: which matter a note belongs to is itself a fact about the firm's work, and
      // a distinguishable refusal would let a caller probe for notes on matters they cannot see.
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "note-retracted":
      return problemJson(c, {
        type: "note-retracted",
        title: "Note withdrawn",
        status: 409,
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

function writeMeta(action: string, permission: typeof WRITE | typeof RETRACT): RouteMeta {
  return {
    operationId: `notes.${action}`,
    surface: "app",
    authenticated: true,
    permission,
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
    "The matter's notes, newest first. A withdrawn note is returned as a tombstone: its author, " +
    "its instants, who withdrew it and why, and never its body, which the read itself nulls " +
    "rather than leaving to the caller to hide. Pass a search term to narrow to the notes whose " +
    "current text contains it; earlier versions are deliberately not matched, so a note corrected " +
    "to take out a name stops being findable by that name.",
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

const readNoteRoute = defineOpenAPIRoute(readMeta("readNote"), {
  method: "get",
  path: "/api/v1/notes/{noteId}",
  description: "One note, as it currently stands.",
  request: { params: noteIdParam },
  responses: {
    200: { description: "The note", content: { "application/json": { schema: NoteDetail } } },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const readNoteHistoryRoute = defineOpenAPIRoute(readMeta("readNoteHistory"), {
  method: "get",
  path: "/api/v1/notes/{noteId}/revisions",
  description:
    "Every body this note has had, oldest first, each with its own author and instant. This is " +
    "what makes correcting a note an addition rather than an overwrite: the earlier words are not " +
    "merely retained, they are readable. A withdrawn note has no readable history: the tombstone " +
    "is not a door around itself. `capped` is true when the note has more versions than were " +
    "returned.",
  request: { params: noteIdParam },
  responses: {
    200: {
      description: "The note's revisions",
      content: { "application/json": { schema: NoteRevisionList } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    429: authErrors[429],
  },
});

const createNoteRoute = defineOpenAPIRoute(writeMeta("createNote", WRITE), {
  method: "post",
  path: "/api/v1/matters/{matterId}/notes",
  description:
    "Writes a note on the matter. The note records who wrote it and when, and those do not change " +
    "afterwards — a correction appends a new version rather than replacing this one, because what " +
    "makes a note worth having is that it was written then, by that person, saying that.",
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

const reviseNoteRoute = defineOpenAPIRoute(writeMeta("reviseNote", WRITE), {
  method: "post",
  path: "/api/v1/notes/{noteId}/revisions",
  description:
    "Corrects a note by adding a new version of its text. The previous version is kept and stays " +
    "readable; the new one becomes what the note shows. A revision is attributed to whoever made " +
    "it, which is not always the note's original author.",
  request: {
    headers: idempotencyKeyHeader,
    params: noteIdParam,
    body: { content: { "application/json": { schema: ReviseNoteRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The note was revised",
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

const retractNoteRoute = defineOpenAPIRoute(writeMeta("retractNote", RETRACT), {
  method: "post",
  path: "/api/v1/notes/{noteId}/retract",
  description:
    "Withdraws a note: its text stops being shown anywhere and it leaves the matter's activity " +
    "history, while the record that it existed, who wrote it, and who withdrew it remains. This is " +
    "the answer to text that should never have been written down — another client's privileged " +
    "material, or somebody's medical information typed in by mistake. Nothing is deleted, and the " +
    "reason is required, because a withdrawal a firm cannot explain later is worse than the note.",
  request: {
    headers: idempotencyKeyHeader,
    params: noteIdParam,
    body: { content: { "application/json": { schema: RetractNoteRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The note was withdrawn",
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

function noteDetail(row: MatterNoteDisplayRow): z.infer<typeof NoteDetail> {
  return {
    id: row.id,
    matterId: row.matter_id,
    authorUserId: row.author_user_id,
    state: row.state,
    body: row.body,
    revisionCount: row.head_ordinal,
    currentRevisionAuthorUserId: row.revision_author_user_id,
    currentRevisionCreatedAt: row.revision_created_at,
    retractedAt: row.retracted_at,
    retractedBy: row.retracted_by,
    retractionReason: row.retraction_reason,
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
  }).all<MatterNoteDisplayRow>();
  const hasMore = results.length > MAX_NOTE_PAGE_SIZE;
  const rows = hasMore ? results.slice(0, MAX_NOTE_PAGE_SIZE) : results;
  const last = rows.at(-1);
  return {
    data: rows.map(noteDetail),
    // The platform's cursor encoding, imported rather than re-spelled — this surface mints no wire
    // contract of its own.
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
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
    { ...readNoteRoute, middleware: chokepointMiddleware(chokepoint, readNoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { noteId } = c.req.valid("param");
      const row = await readMatterNoteDetail(
        firm.firmDatabase,
        noteId as MatterNoteId,
        visibleMatterPredicate(),
      );
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "that note is not a note in this firm",
        });
      }
      return c.json(noteDetail(row), 200);
    },
  );

  // GET /api/v1/notes/{noteId}/revisions
  app.openapi(
    { ...readNoteHistoryRoute, middleware: chokepointMiddleware(chokepoint, readNoteHistoryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { noteId } = c.req.valid("param");
      const note = await readMatterNote(
        firm.firmDatabase,
        noteId as MatterNoteId,
        visibleMatterPredicate(),
      );
      if (note === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "that note is not a note in this firm",
        });
      }
      if (note.state === "retracted") {
        // Refused rather than emptied. Withdrawal stops the body rendering EVERYWHERE, and a history
        // read that still served every superseded body would be a way around the tombstone rather
        // than an exception to it.
        return problemJson(c, {
          type: "note-retracted",
          title: "Note withdrawn",
          status: 409,
          detail:
            "that note was withdrawn; its earlier versions are not readable, which is what withdrawing it did",
        });
      }
      const chain = await readMatterNoteRevisions(firm.firmDatabase, noteId as MatterNoteId, {
        limit: MAX_NOTE_REVISION_PAGE_SIZE,
        visibility: visibleMatterPredicate(),
      });
      return c.json(
        {
          data: chain.revisions.map((revision) => ({
            id: revision.id,
            noteId: revision.note_id,
            body: revision.body,
            authorUserId: revision.author_user_id,
            ordinal: revision.ordinal,
            createdAt: revision.created_at,
          })),
          capped: chain.capped,
        },
        200,
      );
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
          { matterId, body: request.body },
          serviceOptions(userId),
        );
        return Promise.resolve({ id: created.noteId, effect: created.effect });
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: outcome.id }, 201);
    },
  );

  // POST /api/v1/notes/{noteId}/revisions
  app.openapi(
    { ...reviseNoteRoute, middleware: chokepointMiddleware(chokepoint, reviseNoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { noteId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitNoteEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await reviseMatterNote(
          firm.firmDatabase,
          noteId as MatterNoteId,
          { body: request.body },
          serviceOptions(userId),
        );
        return { id: noteId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/notes/{noteId}/retract
  app.openapi(
    { ...retractNoteRoute, middleware: chokepointMiddleware(chokepoint, retractNoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { noteId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitNoteEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await retractMatterNote(
          firm.firmDatabase,
          noteId as MatterNoteId,
          { reason: request.reason },
          serviceOptions(userId),
        );
        return { id: noteId, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );
}

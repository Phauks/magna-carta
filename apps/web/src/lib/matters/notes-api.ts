/*
 * The matter Notes section's response shapes and calls. Mirrors the `notes.*` operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * A note is edited in place and deleted outright. There is no version history to read and no
 * withdrawal state to render: an edit replaces the words, and a delete removes the note.
 *
 * A note carries two different times and they must not be conflated. `createdAt` is when somebody
 * typed it. `occurredOn` / `occurredAtTime` are when the thing it describes happened, which the
 * writer supplies and which is frequently an earlier day.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

/** One of the matter's documents, pointed at by a note. */
export interface NoteDocument {
  /** The ASSOCIATION's own identity, which is what detaching names. Not the document's. */
  id: string;
  fileId: string;
  /** As the File Manager names it, extension included. */
  fileName: string;
  contentType: string | null;
  linkedAt: string;
  linkedBy: string | null;
}

export interface MatterNote {
  id: string;
  matterId: string;
  /** Who wrote it. Still populated when they have left the firm, deliberately. */
  authorUserId: string;
  body: string;
  /** Who last changed the words. Null where nobody has. */
  lastEditedBy: string | null;
  /** When the thing happened, where the note says. Null where it records no single moment. */
  occurredOn: string | null;
  occurredAtTime: string | null;
  timeZone: string | null;
  documents: NoteDocument[];
  /** When it was typed. Never the same question as occurredOn. */
  createdAt: string;
  updatedAt: string;
}

/** What a caller may say about when the thing happened. All three travel together or not at all. */
export interface NoteOccurrenceInput {
  occurredOn?: string | null;
  occurredAtTime?: string | null;
  timeZone?: string | null;
}

/**
 * The matter's notes, most recent first — ordered by when each note says the thing happened, falling
 * back to the day it was written. `search` narrows to the notes whose text contains the term.
 */
export function listMatterNotes(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
  search?: string,
): Promise<ApiOutcome<Page<MatterNote>>> {
  const query = new URLSearchParams({
    ...(cursor === undefined ? {} : { cursor }),
    ...(search === undefined || search.trim().length === 0 ? {} : { search: search.trim() }),
  });
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/notes${suffix}`);
}

/** One note by its id, through the matter's visibility. Refused where the note is not on a matter the member may see. */
export function readMatterNote(
  fetchImpl: typeof fetch,
  noteId: string,
): Promise<ApiOutcome<MatterNote>> {
  return requestJson(fetchImpl, `/api/v1/notes/${encodeURIComponent(noteId)}`);
}

export function createMatterNote(
  fetchImpl: typeof fetch,
  matterId: string,
  note: { body: string } & NoteOccurrenceInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/notes`, {
    method: "POST",
    body: note,
    idempotencyKey,
  });
}

/** Replaces the note's text. What it said before is not kept. */
export function editMatterNote(
  fetchImpl: typeof fetch,
  noteId: string,
  note: { body: string } & NoteOccurrenceInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/notes/${encodeURIComponent(noteId)}`, {
    method: "PATCH",
    body: note,
    idempotencyKey,
  });
}

/** Removes the note and its text. Documents it pointed at are untouched. */
export function deleteMatterNote(
  fetchImpl: typeof fetch,
  noteId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** Points the note at one of the matter's documents. The document is not copied or moved. */
export function attachNoteDocument(
  fetchImpl: typeof fetch,
  noteId: string,
  fileId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/notes/${encodeURIComponent(noteId)}/documents`, {
    method: "POST",
    body: { fileId },
    idempotencyKey,
  });
}

/** Ends the association. The document stays in the matter's files. */
export function detachNoteDocument(
  fetchImpl: typeof fetch,
  attachmentId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/note-documents/${encodeURIComponent(attachmentId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** A fresh idempotency key per submitted write, so a retry of THAT write is the same write. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}

/**
 * The zone a note's wall-clock time is read in, defaulted to the writer's own. The server requires
 * a zone whenever there is a time, and the browser knows the only honest default there is.
 */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

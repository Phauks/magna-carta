/*
 * The matter Notes section's response shapes and calls. Mirrors the `notes.*` operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * A note is a chain, not a field. Correcting one adds a version and keeps the old one, so there are
 * two reads here: the matter's notes as they currently stand, and one note's whole history. There is
 * no delete call because the server has no delete route: a note is withdrawn, which stops its text
 * being shown and keeps the record that it existed.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

export type NoteState = "active" | "retracted";

export interface MatterNote {
  id: string;
  matterId: string;
  /** Who wrote it first. Still populated when they have left the firm, deliberately. */
  authorUserId: string;
  state: NoteState;
  /** Null on a withdrawn note, always: the server nulls it rather than trusting the client. */
  body: string | null;
  /** One means it has never been corrected. */
  revisionCount: number;
  /** Whoever wrote the version currently showing, which is not always the original author. */
  currentRevisionAuthorUserId: string | null;
  currentRevisionCreatedAt: string | null;
  retractedAt: string | null;
  retractedBy: string | null;
  retractionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MatterNoteRevision {
  id: string;
  noteId: string;
  body: string;
  authorUserId: string;
  ordinal: number;
  createdAt: string;
}

/**
 * The matter's notes, newest first. Withdrawn notes are included, as tombstones.
 *
 * `search` narrows to the notes whose CURRENT text contains the term. Earlier versions are not
 * matched, deliberately: a note corrected to take out a name should stop being findable by it.
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

/**
 * Every version this note has had, oldest first. Refused with 409 on a withdrawn note.
 *
 * A capped answer, not a paged one: `capped` is true when the note has more versions than were
 * returned, which is the difference between "that is all" and "we stopped counting".
 */
export function listNoteRevisions(
  fetchImpl: typeof fetch,
  noteId: string,
): Promise<ApiOutcome<{ data: MatterNoteRevision[]; capped: boolean }>> {
  return requestJson(fetchImpl, `/api/v1/notes/${encodeURIComponent(noteId)}/revisions`);
}

export function createMatterNote(
  fetchImpl: typeof fetch,
  matterId: string,
  body: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/notes`, {
    method: "POST",
    body: { body },
    idempotencyKey,
  });
}

export function reviseMatterNote(
  fetchImpl: typeof fetch,
  noteId: string,
  body: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/notes/${encodeURIComponent(noteId)}/revisions`, {
    method: "POST",
    body: { body },
    idempotencyKey,
  });
}

export function retractMatterNote(
  fetchImpl: typeof fetch,
  noteId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/notes/${encodeURIComponent(noteId)}/retract`, {
    method: "POST",
    body: { reason },
    idempotencyKey,
  });
}

/** A fresh idempotency key per submitted write, so a retry of THAT write is the same write. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}

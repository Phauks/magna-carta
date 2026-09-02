import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  FileId,
  MatterId,
  MatterNoteDocumentId,
  MatterNoteId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  countMatterNoteDocuments,
  deleteMatterNoteDocumentStatement,
  deleteMatterNoteDocumentsStatement,
  deleteMatterNoteStatement,
  fileIsOnMatter,
  insertMatterNoteDocumentStatement,
  insertMatterNoteStatement,
  readMatterNote,
  readMatterNoteDocument,
  updateMatterNoteStatement,
} from "./note-statements.ts";
import { MAX_NOTE_DOCUMENT_COUNT } from "./types.ts";
import { NoteValidationError, normalizeNoteBody, normalizeOccurrence } from "./validation.ts";

// The matter note's write paths: create, edit, delete, and the two that attach and detach a file.
//
// A note is edited in place and deleted outright. The first cut of this package kept a revision chain
// and made withdrawal a state; the owner's direction on 2026-09-01 replaced it, because replacing a
// note with another note every time somebody fixes a word accumulates without end. What that costs —
// no record of what a note said before, and nothing left behind when one is deleted — is stated in
// the package's CLAUDE.md rather than argued at each call site.
//
// Nothing here reads a clock, holds a database binding, or calls anything external: the clock, the
// actor and the random source arrive as options, which is what lets a fixture mint a byte-identical
// batch.

export interface NoteServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
  // The same predicate the federated timeline composes. Every read on the way to a write goes
  // through it, so an id-addressed write path cannot reach a note a matter-scoped read could not.
  readonly visibility: VisibleMatterPredicate;
}

export interface NoteOccurrenceInput {
  readonly occurredOn?: string | null;
  readonly occurredAtTime?: string | null;
  readonly timeZone?: string | null;
}

export interface CreateMatterNoteInput extends NoteOccurrenceInput {
  readonly matterId: MatterId;
  readonly body: string;
}

export function createMatterNote(
  database: SqlDatabase,
  input: CreateMatterNoteInput,
  options: NoteServiceOptions,
): { noteId: MatterNoteId; effect: EffectWrite } {
  const body = normalizeNoteBody(input.body);
  const occurrence = normalizeOccurrence(input);
  const now = options.clock.now();
  const noteId = newIdentifier("matterNote", options.randomSource);
  return {
    noteId,
    effect: {
      statements: [
        insertMatterNoteStatement(database, {
          id: noteId,
          matterId: input.matterId,
          authorUserId: options.actorUserId,
          body,
          occurrence,
          now,
        }),
        domainAuditStatement(database, {
          event: "notes.note.created",
          subjectId: noteId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers and the occurrence date only. Not the body, not its first words, not its
          // length — a note body is the most privileged free text the firm writes, and the audit log
          // is a compliance record with its own retention and its own readers. The date the note
          // describes is a date, which discloses nothing on its own.
          metadata: { matterId: input.matterId, occurredOn: occurrence.occurredOn },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface EditMatterNoteInput extends NoteOccurrenceInput {
  readonly body: string;
}

// Editing a note. The words are replaced and the previous ones are gone: there is no version to fall
// back to, which is the model the owner chose and the reason the audit row below records that an edit
// happened at all.
export async function editMatterNote(
  database: SqlDatabase,
  noteId: MatterNoteId,
  input: EditMatterNoteInput,
  options: NoteServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const body = normalizeNoteBody(input.body);
  const occurrence = normalizeOccurrence(input);
  const note = await readMatterNote(database, noteId, options.visibility);
  if (note === undefined) {
    throw new NoteValidationError("note-unknown", "that note is not a note in this firm");
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateMatterNoteStatement(database, {
          id: noteId,
          body,
          occurrence,
          editedBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "notes.note.edited",
          subjectId: noteId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // That the note changed, and when it now says the thing happened. Never the words, in
          // either direction: the log records neither what it said nor what it says.
          metadata: { matterId: note.matter_id, occurredOn: occurrence.occurredOn },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Deleting a note. The row goes and its words go with it — this is a real delete, not a state.
//
// The audit row is the only thing that survives, and it carries identifiers rather than text, so
// afterwards the firm can see that a note existed on this matter and who removed it, and cannot see
// what it said. That is the shape the owner chose over a tombstone.
//
// The links go first and the documents do not: detaching leaves every attached file exactly where it
// lives in the matter's file record. Deleting a note has never been a way to delete a document.
export async function deleteMatterNote(
  database: SqlDatabase,
  noteId: MatterNoteId,
  options: NoteServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const note = await readMatterNote(database, noteId, options.visibility);
  if (note === undefined) {
    throw new NoteValidationError("note-unknown", "that note is not a note in this firm");
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        deleteMatterNoteDocumentsStatement(database, noteId),
        deleteMatterNoteStatement(database, noteId),
        domainAuditStatement(database, {
          event: "notes.note.deleted",
          subjectId: noteId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: note.matter_id, createdAt: note.created_at },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Linking one of the matter's files to a note.
//
// The file must already be a live file on this note's own matter. A link across matters would be a
// disclosure wearing an association, and refusing it here is why the note surface can offer the
// matter's file list without a second visibility argument.
export async function attachFileToMatterNote(
  database: SqlDatabase,
  noteId: MatterNoteId,
  fileId: FileId,
  options: NoteServiceOptions,
): Promise<{ linkId: MatterNoteDocumentId; effect: EffectWrite }> {
  const note = await readMatterNote(database, noteId, options.visibility);
  if (note === undefined) {
    throw new NoteValidationError("note-unknown", "that note is not a note in this firm");
  }
  if (!(await fileIsOnMatter(database, fileId, note.matter_id))) {
    throw new NoteValidationError(
      "note-file-matter-mismatch",
      "a note points only at documents on its own matter",
    );
  }
  if ((await countMatterNoteDocuments(database, noteId)) >= MAX_NOTE_DOCUMENT_COUNT) {
    throw new NoteValidationError(
      "note-too-many-files",
      `a note points at at most ${String(MAX_NOTE_DOCUMENT_COUNT)} documents`,
    );
  }
  const now = options.clock.now();
  const linkId = newIdentifier("matterNoteDocument", options.randomSource);
  return {
    linkId,
    effect: {
      statements: [
        // A second identical link collides on the (note_id, file_id) unique index and aborts the
        // batch, which is the right outcome: one document rides one note once, and two rows a person
        // reads as the same file twice would detach separately.
        insertMatterNoteDocumentStatement(database, {
          id: linkId,
          noteId,
          fileId,
          linkedBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "notes.note.documentAttached",
          subjectId: noteId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: note.matter_id, fileId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Unlinking. The association ends; the document stays in the matter's files, untouched.
export async function detachFileFromMatterNote(
  database: SqlDatabase,
  linkId: MatterNoteDocumentId,
  options: NoteServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const link = await readMatterNoteDocument(database, linkId, options.visibility);
  if (link === undefined) {
    throw new NoteValidationError(
      "note-unknown-file",
      "that attachment is not on a note in this firm",
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        deleteMatterNoteDocumentStatement(database, linkId),
        domainAuditStatement(database, {
          event: "notes.note.documentDetached",
          subjectId: link.note_id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { linkId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

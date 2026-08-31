import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, MatterNoteId, UserId } from "@magna-carta/identifiers/types";
import {
  advanceMatterNoteHeadStatement,
  insertMatterNoteRevisionStatement,
  insertMatterNoteStatement,
  readMatterNote,
  retractMatterNoteStatement,
} from "./note-statements.ts";
import { NoteValidationError, normalizeNoteBody, normalizeRetractionReason } from "./validation.ts";

// The matter note's three write paths, and there are exactly three.
//
// CREATE writes an identity and its first revision in one batch. REVISE appends a revision and moves
// the head in one batch. RETRACT moves a state. There is no fourth, and in particular there is no
// delete: no route mints one, no capability names one, and the two tables' own triggers refuse the
// statements that would implement one. The single case where bytes genuinely must leave the database
// is a legal one — an erasure obligation, or another person's protected data typed into a note by
// mistake — and that routes through the PII registry's report-manual action, which surfaces the note
// in the residue report for a person to decide about. The platform neither silently erases a note
// nor silently refuses to.
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

export interface CreateMatterNoteInput {
  readonly matterId: MatterId;
  readonly body: string;
}

export function createMatterNote(
  database: SqlDatabase,
  input: CreateMatterNoteInput,
  options: NoteServiceOptions,
): { noteId: MatterNoteId; effect: EffectWrite } {
  const body = normalizeNoteBody(input.body);
  const now = options.clock.now();
  const noteId = newIdentifier("matterNote", options.randomSource);
  const revisionId = newIdentifier("matterNoteRevision", options.randomSource);
  return {
    noteId,
    effect: {
      statements: [
        insertMatterNoteStatement(database, {
          id: noteId,
          matterId: input.matterId,
          authorUserId: options.actorUserId,
          now,
        }),
        insertMatterNoteRevisionStatement(database, {
          id: revisionId,
          noteId,
          body,
          authorUserId: options.actorUserId,
          ordinal: 1,
          now,
        }),
        domainAuditStatement(database, {
          event: "notes.note.created",
          subjectId: noteId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers only. Not the body, not its first words, not its length — a note body is the
          // most privileged free text the firm writes, and the audit log is a compliance record with
          // its own retention and its own readers.
          metadata: { matterId: input.matterId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface ReviseMatterNoteInput {
  readonly body: string;
}

// Correcting a note. The prior body is not replaced — it stays as its own row, with its own author
// and its own instant, and the head moves onto the new one.
//
// The author of a revision is whoever is revising, which is not always whoever started the note: a
// colleague correcting a partner's note is ordinary, and the correction belongs to the person who
// made it.
export async function reviseMatterNote(
  database: SqlDatabase,
  noteId: MatterNoteId,
  input: ReviseMatterNoteInput,
  options: NoteServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const body = normalizeNoteBody(input.body);
  const note = await readMatterNote(database, noteId, options.visibility);
  if (note === undefined) {
    throw new NoteValidationError("note-unknown", "that note is not a note in this firm");
  }
  if (note.state === "retracted") {
    throw new NoteValidationError(
      "note-retracted",
      "that note was withdrawn; a withdrawn note is not revised, because nothing would render the new words",
    );
  }
  const now = options.clock.now();
  const revisionId = newIdentifier("matterNoteRevision", options.randomSource);
  const nextOrdinal = note.head_ordinal + 1;
  return {
    effect: {
      statements: [
        // The revision insert leads. Two members revising at once both compute this same ordinal, and
        // the unique index on (note_id, ordinal) makes the second one abort the whole batch — head
        // move and audit row included. One writer loses cleanly; neither overwrites the other.
        insertMatterNoteRevisionStatement(database, {
          id: revisionId,
          noteId,
          body,
          authorUserId: options.actorUserId,
          ordinal: nextOrdinal,
          now,
        }),
        advanceMatterNoteHeadStatement(database, {
          id: noteId,
          fromOrdinal: note.head_ordinal,
          toOrdinal: nextOrdinal,
          now,
        }),
        domainAuditStatement(database, {
          event: "notes.note.revised",
          subjectId: noteId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The ordinal says the note now has an nth version. It says nothing about what changed,
          // which is the part that would be privileged.
          metadata: { matterId: note.matter_id, ordinal: nextOrdinal },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface RetractMatterNoteInput {
  readonly reason: string;
}

// Withdrawing a note. The body stops rendering everywhere — the matter surface shows a tombstone, the
// federated timeline drops the entry, the history read refuses — while the row, its revisions, its
// author and its instants all remain.
//
// This is the answer to "this should never have been written", and it is deliberately VISIBLE. A
// firm can see that a note was retracted and by whom, which is what makes retraction usable as a
// correction rather than a quiet erasure — and it is why the reason is required rather than optional.
export async function retractMatterNote(
  database: SqlDatabase,
  noteId: MatterNoteId,
  input: RetractMatterNoteInput,
  options: NoteServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const reason = normalizeRetractionReason(input.reason);
  const note = await readMatterNote(database, noteId, options.visibility);
  if (note === undefined) {
    throw new NoteValidationError("note-unknown", "that note is not a note in this firm");
  }
  if (note.state === "retracted") {
    throw new NoteValidationError(
      "note-retracted",
      "that note was already withdrawn; the first withdrawal's actor, instant and reason are the record and are not rewritten",
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        retractMatterNoteStatement(database, {
          id: noteId,
          retractedBy: options.actorUserId,
          reason,
          now,
        }),
        domainAuditStatement(database, {
          event: "notes.note.retracted",
          subjectId: noteId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The reason is deliberately NOT carried here. It is a sentence a person wrote about a note
          // whose whole point is that its content should stop circulating, and the audit log is read
          // by people and processes that the note itself is screened from. The reason lives on the
          // note row, behind the same permission as the note.
          metadata: { matterId: note.matter_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}

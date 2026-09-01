import { describe, expect, it } from "vitest";
import {
  attachFileToMatterNote,
  createMatterNote,
  deleteMatterNote,
  detachFileFromMatterNote,
  editMatterNote,
} from "../src/note-service.ts";
import {
  readMatterNote,
  readMatterNoteDocuments,
  selectMatterNotesStatement,
  type MatterNoteRow,
} from "../src/note-statements.ts";
import { NoteValidationError } from "../src/validation.ts";
import { MAX_NOTE_BODY_LENGTH } from "../src/types.ts";
import {
  ACTOR,
  COLLEAGUE,
  HOLDING_MATTER,
  MATTER,
  OTHER_MATTER,
  commit,
  migratedDatabase,
  options,
  seedFile,
  seedFirm,
  tickingClock,
  visibility,
} from "./support.ts";
import type { FileId, MatterNoteId } from "@magna-carta/identifiers/types";

const BODY = "Spoke to Mrs Herrera on Tuesday. She is thinking about the offer.";

async function listFor(
  database: Parameters<typeof selectMatterNotesStatement>[0],
  search?: string,
): Promise<readonly MatterNoteRow[]> {
  const { results } = await selectMatterNotesStatement(database, MATTER, {
    limit: 50,
    visibility,
    search,
  }).all<MatterNoteRow>();
  return results;
}

async function writeNote(input: Partial<Parameters<typeof createMatterNote>[1]> = {}) {
  const { database, raw } = migratedDatabase();
  seedFirm(raw);
  const created = createMatterNote(database, { matterId: MATTER, body: BODY, ...input }, options);
  await commit(database, created.effect);
  return { database, raw, noteId: created.noteId };
}

describe("writing a note", () => {
  it("records the matter, the author, the instant and the words", async () => {
    const { database, noteId } = await writeNote();
    const note = await readMatterNote(database, noteId, visibility);
    expect(note?.matter_id).toBe(MATTER);
    expect(note?.author_user_id).toBe(ACTOR);
    expect(note?.body).toBe(BODY);
    // Nobody has edited it, which is a different fact from "the author edited their own note".
    expect(note?.last_edited_by).toBeNull();
  });

  it("refuses an empty body and a body past the ceiling", () => {
    const { database } = migratedDatabase();
    expect(() => createMatterNote(database, { matterId: MATTER, body: "   " }, options)).toThrow(
      NoteValidationError,
    );
    expect(() =>
      createMatterNote(
        database,
        { matterId: MATTER, body: "x".repeat(MAX_NOTE_BODY_LENGTH + 1) },
        options,
      ),
    ).toThrow(NoteValidationError);
  });
});

describe("when the thing happened", () => {
  it("keeps the day it happened apart from the day it was typed", async () => {
    const { database, noteId } = await writeNote({
      body: "Call with the client.",
      occurredOn: "2026-08-25",
      occurredAtTime: "15:30",
      timeZone: "America/Los_Angeles",
    });
    const note = await readMatterNote(database, noteId, visibility);
    expect(note?.occurred_on).toBe("2026-08-25");
    expect(note?.occurred_at_time).toBe("15:30");
    expect(note?.time_zone).toBe("America/Los_Angeles");
    // The typing instant is its own fact and is not overwritten by the occurrence.
    expect(note?.created_at).not.toContain("2026-08-25");
  });

  it("accepts a date with no time, which is the common case", async () => {
    const { database, noteId } = await writeNote({ occurredOn: "2026-08-25" });
    const note = await readMatterNote(database, noteId, visibility);
    expect(note?.occurred_on).toBe("2026-08-25");
    expect(note?.occurred_at_time).toBeNull();
    expect(note?.time_zone).toBeNull();
  });

  it("refuses a time with no date, a time with no zone, and a zone with no time", () => {
    const { database } = migratedDatabase();
    const base = { matterId: MATTER, body: BODY } as const;
    // An hour with no day is not a moment anybody can place.
    expect(() => createMatterNote(database, { ...base, occurredAtTime: "15:30" }, options)).toThrow(
      NoteValidationError,
    );
    // A wall clock with no zone is not a time to anybody in another state.
    expect(() =>
      createMatterNote(
        database,
        { ...base, occurredOn: "2026-08-25", occurredAtTime: "15:30" },
        options,
      ),
    ).toThrow(NoteValidationError);
    // And a zone on a note that names no time says nothing.
    expect(() =>
      createMatterNote(
        database,
        { ...base, occurredOn: "2026-08-25", timeZone: "America/Los_Angeles" },
        options,
      ),
    ).toThrow(NoteValidationError);
  });

  it("refuses a date that is not on the calendar, and a zone nothing can resolve", () => {
    const { database } = migratedDatabase();
    const base = { matterId: MATTER, body: BODY } as const;
    expect(() =>
      createMatterNote(database, { ...base, occurredOn: "2026-02-30" }, options),
    ).toThrow(NoteValidationError);
    expect(() =>
      createMatterNote(
        database,
        { ...base, occurredOn: "2026-08-25", occurredAtTime: "09:00", timeZone: "Mars/Olympus" },
        options,
      ),
    ).toThrow(NoteValidationError);
  });

  it("orders the list by when things happened, not by when they were typed", async () => {
    const fresh = migratedDatabase();
    seedFirm(fresh.raw);
    const clock = tickingClock();
    // Typed in this order; happened in the reverse.
    for (const [body, occurredOn] of [
      ["Oldest event, typed first.", "2026-08-01"],
      ["Newest event, typed second.", "2026-08-20"],
    ] as const) {
      const created = createMatterNote(
        fresh.database,
        { matterId: MATTER, body, occurredOn },
        { ...options, clock },
      );
      await commit(fresh.database, created.effect);
    }
    const { results } = await selectMatterNotesStatement(fresh.database, MATTER, {
      limit: 50,
      visibility,
    }).all<MatterNoteRow>();
    expect(results.map((row) => row.occurred_on)).toEqual(["2026-08-20", "2026-08-01"]);
  });

  it("falls back to the day it was written when the note names no occurrence", async () => {
    const { database, raw } = migratedDatabase();
    seedFirm(raw);
    const clock = tickingClock();
    const undated = createMatterNote(
      database,
      { matterId: MATTER, body: "No date on this one." },
      { ...options, clock },
    );
    await commit(database, undated.effect);
    const dated = createMatterNote(
      database,
      { matterId: MATTER, body: "Happened long ago.", occurredOn: "2020-01-01" },
      { ...options, clock },
    );
    await commit(database, dated.effect);

    const { results } = await selectMatterNotesStatement(database, MATTER, {
      limit: 50,
      visibility,
    }).all<MatterNoteRow>();
    // The undated note sorts on its written day, which is today, so it leads the one from 2020.
    expect(results[0]?.id).toBe(undated.noteId);
    expect(results[1]?.id).toBe(dated.noteId);
  });
});

describe("editing a note", () => {
  it("replaces the words and records who changed them", async () => {
    const { database, noteId } = await writeNote();
    const { effect } = await editMatterNote(
      database,
      noteId,
      { body: "Corrected account of the call." },
      { ...options, actorUserId: COLLEAGUE, clock: tickingClock() },
    );
    await commit(database, effect);

    const note = await readMatterNote(database, noteId, visibility);
    expect(note?.body).toBe("Corrected account of the call.");
    // The note still belongs to whoever started it; the change belongs to whoever made it.
    expect(note?.author_user_id).toBe(ACTOR);
    expect(note?.last_edited_by).toBe(COLLEAGUE);
  });

  it("keeps nothing of what the note said before", async () => {
    const { database, raw, noteId } = await writeNote({ body: "The original words." });
    const { effect } = await editMatterNote(
      database,
      noteId,
      { body: "The replacement words." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);
    // The model the owner chose: an edit overwrites. Nothing anywhere holds the earlier text.
    const rows = raw.prepare("SELECT body FROM matter_note").all() as { body: string }[];
    expect(rows.map((row) => row.body)).toEqual(["The replacement words."]);
    expect(JSON.stringify(rows)).not.toContain("original");
  });

  it("can move the occurrence, and can clear it", async () => {
    const { database, noteId } = await writeNote({ occurredOn: "2026-08-25" });
    const { effect } = await editMatterNote(
      database,
      noteId,
      { body: BODY, occurredOn: "2026-08-26" },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);
    expect((await readMatterNote(database, noteId, visibility))?.occurred_on).toBe("2026-08-26");

    const cleared = await editMatterNote(
      database,
      noteId,
      { body: BODY },
      { ...options, clock: tickingClock() },
    );
    await commit(database, cleared.effect);
    expect((await readMatterNote(database, noteId, visibility))?.occurred_on).toBeNull();
  });

  it("refuses a note that is not this firm's", async () => {
    const { database } = await writeNote();
    await expect(
      editMatterNote(
        database,
        "matterNote_absent0000000000000" as MatterNoteId,
        { body: "x" },
        options,
      ),
    ).rejects.toThrow(NoteValidationError);
  });
});

describe("deleting a note", () => {
  it("removes the row and its words", async () => {
    const { database, raw, noteId } = await writeNote({ body: "Words that will not survive." });
    const { effect } = await deleteMatterNote(database, noteId, {
      ...options,
      clock: tickingClock(),
    });
    await commit(database, effect);

    expect(await readMatterNote(database, noteId, visibility)).toBeUndefined();
    const remaining = raw.prepare("SELECT COUNT(*) AS count FROM matter_note").get() as {
      count: number;
    };
    expect(remaining.count).toBe(0);
  });

  it("leaves an audit row that says a note existed and never what it said", async () => {
    const { database, raw, noteId } = await writeNote({ body: "Privileged and gone." });
    const { effect } = await deleteMatterNote(database, noteId, {
      ...options,
      clock: tickingClock(),
    });
    await commit(database, effect);

    const audit = raw
      .prepare(
        "SELECT event, subject_id, metadata FROM audit_log WHERE event = 'notes.note.deleted'",
      )
      .all() as { event: string; subject_id: string; metadata: string | null }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]?.subject_id).toBe(noteId);
    expect(JSON.stringify(audit)).not.toContain("Privileged");
  });

  it("detaches its files and deletes none of them", async () => {
    const { database, raw, noteId } = await writeNote();
    const fileId = seedFile(raw, MATTER, "letter.pdf");
    const attached = await attachFileToMatterNote(database, noteId, fileId, options);
    await commit(database, attached.effect);

    const { effect } = await deleteMatterNote(database, noteId, {
      ...options,
      clock: tickingClock(),
    });
    await commit(database, effect);

    const links = raw.prepare("SELECT COUNT(*) AS count FROM matter_note_document").get() as {
      count: number;
    };
    expect(links.count).toBe(0);
    // The document is untouched. Deleting a note has never been a way to delete a document.
    const files = raw
      .prepare("SELECT COUNT(*) AS count FROM file WHERE id = ? AND deleted_at IS NULL")
      .get(fileId) as { count: number };
    expect(files.count).toBe(1);
  });
});

describe("the files a note points at", () => {
  it("links one of the matter's documents and reads it back with its name", async () => {
    const { database, raw, noteId } = await writeNote();
    const fileId = seedFile(raw, MATTER, "engagement-letter.pdf");
    const { effect } = await attachFileToMatterNote(database, noteId, fileId, options);
    await commit(database, effect);

    const documents = await readMatterNoteDocuments(database, [noteId], visibility);
    expect(documents).toHaveLength(1);
    expect(documents[0]?.file_id).toBe(fileId);
    // The name comes from the matter's file record rather than a second copy that could drift.
    expect(documents[0]?.file_name).toBe("engagement-letter.pdf");
    expect(documents[0]?.linked_by).toBe(ACTOR);
  });

  it("refuses a document from another matter", async () => {
    const { database, raw, noteId } = await writeNote();
    const elsewhere = seedFile(raw, OTHER_MATTER, "someone-elses.pdf");
    await expect(attachFileToMatterNote(database, noteId, elsewhere, options)).rejects.toThrow(
      NoteValidationError,
    );
  });

  it("refuses a file that does not exist", async () => {
    const { database, noteId } = await writeNote();
    await expect(
      attachFileToMatterNote(database, noteId, "file_absent00000000000" as FileId, options),
    ).rejects.toThrow(NoteValidationError);
  });

  it("refuses the same document twice on one note", async () => {
    const { database, raw, noteId } = await writeNote();
    const fileId = seedFile(raw, MATTER, "letter.pdf");
    const first = await attachFileToMatterNote(database, noteId, fileId, options);
    await commit(database, first.effect);
    const second = await attachFileToMatterNote(database, noteId, fileId, {
      ...options,
      clock: tickingClock(),
    });
    // The unique index is what refuses it, so the batch aborts rather than writing a duplicate.
    await expect(commit(database, second.effect)).rejects.toThrow(/UNIQUE/iu);
  });

  it("lets one document ride two notes", async () => {
    const { database, raw, noteId } = await writeNote();
    const fileId = seedFile(raw, MATTER, "appraisal.pdf");
    const second = createMatterNote(
      database,
      { matterId: MATTER, body: "The follow-up call about the same letter." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, second.effect);

    for (const target of [noteId, second.noteId]) {
      const link = await attachFileToMatterNote(database, target, fileId, {
        ...options,
        clock: tickingClock(),
      });
      await commit(database, link.effect);
    }
    const documents = await readMatterNoteDocuments(database, [noteId, second.noteId], visibility);
    expect(documents).toHaveLength(2);
  });

  it("detaching ends the association and keeps the document", async () => {
    const { database, raw, noteId } = await writeNote();
    const fileId = seedFile(raw, MATTER, "letter.pdf");
    const attached = await attachFileToMatterNote(database, noteId, fileId, options);
    await commit(database, attached.effect);

    const { effect } = await detachFileFromMatterNote(database, attached.linkId, {
      ...options,
      clock: tickingClock(),
    });
    await commit(database, effect);

    expect(await readMatterNoteDocuments(database, [noteId], visibility)).toHaveLength(0);
    const files = raw
      .prepare("SELECT COUNT(*) AS count FROM file WHERE id = ? AND deleted_at IS NULL")
      .get(fileId) as { count: number };
    expect(files.count).toBe(1);
  });
});

describe("the matter's note list", () => {
  it("never reaches another matter, or the platform's own holding matter", async () => {
    const { database, raw } = await writeNote();
    const clock = tickingClock();
    for (const matterId of [OTHER_MATTER, HOLDING_MATTER]) {
      const created = createMatterNote(
        database,
        { matterId, body: `A note on ${matterId}.` },
        { ...options, clock },
      );
      await commit(database, created.effect);
    }
    expect(await listFor(database)).toHaveLength(1);

    const holding = await selectMatterNotesStatement(database, HOLDING_MATTER, {
      limit: 50,
      visibility,
    }).all<MatterNoteRow>();
    expect(holding.results).toHaveLength(0);
    // The row really is there; it is the predicate keeping it out, not an empty table.
    const stored = raw
      .prepare("SELECT COUNT(*) AS count FROM matter_note WHERE matter_id = ?")
      .get(HOLDING_MATTER) as { count: number };
    expect(stored.count).toBe(1);
  });

  it("finds a note by its current words, and not by words edited out of it", async () => {
    const { database, noteId } = await writeNote({ body: "Client says Nowak was driving." });
    expect(await listFor(database, "Nowak")).toHaveLength(1);

    const { effect } = await editMatterNote(
      database,
      noteId,
      { body: "Client says Novak was driving." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);

    expect(await listFor(database, "Nowak")).toHaveLength(0);
    expect(await listFor(database, "Novak")).toHaveLength(1);
  });

  it("treats a wildcard in the term as text a lawyer typed, not as an instruction", async () => {
    const { database } = await writeNote({ body: "Fee split is 50% to co-counsel." });
    const percentMatches = await listFor(database, "50%");
    expect(percentMatches).toHaveLength(1);
    expect(percentMatches[0]?.body).toContain("50%");
  });
});

describe("attribution outlives the author", () => {
  it("keeps a departed member's name on the note", async () => {
    const { database, raw } = migratedDatabase();
    seedFirm(raw);
    const created = createMatterNote(
      database,
      { matterId: MATTER, body: "Per Sarah Chen, the indemnity survives termination." },
      { ...options, actorUserId: "user_noteDeparted00" as never },
    );
    await commit(database, created.effect);

    const note = await readMatterNote(database, created.noteId, visibility);
    // The column does not null, repoint, or anonymize when a member leaves. That they have left is a
    // JOIN on member.status at read time, which is why the note itself needs no column for it.
    expect(note?.author_user_id).toBe("user_noteDeparted00");
    const member = raw
      .prepare("SELECT status FROM member WHERE user_id = ?")
      .get("user_noteDeparted00") as { status: string };
    expect(member.status).toBe("deactivated");
  });
});

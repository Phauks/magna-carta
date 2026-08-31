import { describe, expect, it } from "vitest";
import { createMatterNote, reviseMatterNote } from "../src/note-service.ts";
import {
  ACTOR,
  MATTER,
  commit,
  migratedDatabase,
  options,
  seedFirm,
  tickingClock,
} from "./support.ts";

// The revision table is append-only, and these prove the database says so rather than this package.
//
// The distinction matters: application code that appends and never rewrites is true until a repair
// script, a bulk import fix, or a well-meant autosave feature reaches the table directly. Every
// assertion here goes around the service and issues the statement by hand, which is exactly what
// such a caller would do.

async function noteWithTwoRevisions() {
  const { database, raw } = migratedDatabase();
  seedFirm(raw);
  const created = createMatterNote(
    database,
    { matterId: MATTER, body: "The first body." },
    options,
  );
  await commit(database, created.effect);
  const { effect } = await reviseMatterNote(
    database,
    created.noteId,
    { body: "The second body." },
    { ...options, clock: tickingClock() },
  );
  await commit(database, effect);
  return { raw, noteId: created.noteId };
}

describe("a note's revisions cannot be rewritten", () => {
  it("refuses an UPDATE against a stored body", async () => {
    const { raw, noteId } = await noteWithTwoRevisions();
    expect(() =>
      raw
        .prepare("UPDATE matter_note_revision SET body = ? WHERE note_id = ?")
        .run("Something else entirely.", noteId),
    ).toThrow(/append-only/u);
  });

  it("refuses a DELETE against a stored revision", async () => {
    const { raw, noteId } = await noteWithTwoRevisions();
    expect(() =>
      raw.prepare("DELETE FROM matter_note_revision WHERE note_id = ?").run(noteId),
    ).toThrow(/append-only/u);
  });

  it("refuses an INSERT OR REPLACE onto an existing revision", async () => {
    const { raw, noteId } = await noteWithTwoRevisions();
    const existing = raw
      .prepare("SELECT id FROM matter_note_revision WHERE note_id = ? ORDER BY ordinal LIMIT 1")
      .get(noteId) as { id: string };
    // REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing BEFORE DELETE or
    // BEFORE UPDATE, so this is the one path the other two triggers do not close.
    expect(() =>
      raw
        .prepare(
          "INSERT OR REPLACE INTO matter_note_revision (id, note_id, body, author_user_id, ordinal, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(existing.id, noteId, "Overwritten.", ACTOR, 1, "2026-08-31T13:00:00.000Z"),
    ).toThrow(/append-only/u);
  });

  it("still allows an ordinary append, which is the whole point", async () => {
    const { raw, noteId } = await noteWithTwoRevisions();
    expect(() =>
      raw
        .prepare(
          "INSERT INTO matter_note_revision (id, note_id, body, author_user_id, ordinal, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          "matterNoteRevision_appended000000000",
          noteId,
          "A third body.",
          ACTOR,
          3,
          "2026-08-31T13:00:00.000Z",
        ),
    ).not.toThrow();
  });

  it("refuses two revisions claiming the same place in the chain", async () => {
    const { raw, noteId } = await noteWithTwoRevisions();
    // Two members revising at once compute the same next ordinal; the unique index is what makes
    // the second one lose cleanly instead of overwriting the first one's words.
    expect(() =>
      raw
        .prepare(
          "INSERT INTO matter_note_revision (id, note_id, body, author_user_id, ordinal, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          "matterNoteRevision_collision00000000",
          noteId,
          "A racing second body.",
          ACTOR,
          2,
          "2026-08-31T13:00:00.000Z",
        ),
    ).toThrow(/UNIQUE/iu);
  });
});

describe("the note head is not append-only, deliberately", () => {
  it("lets the state move, which is how a note is withdrawn", async () => {
    const { raw, noteId } = await noteWithTwoRevisions();
    expect(() =>
      raw
        .prepare(
          "UPDATE matter_note SET state = 'retracted', retracted_at = ?, retracted_by = ?, retraction_reason = ?, updated_at = ? WHERE id = ?",
        )
        .run("2026-08-31T13:00:00.000Z", ACTOR, "Withdrawn.", "2026-08-31T13:00:00.000Z", noteId),
    ).not.toThrow();
  });

  it("refuses a retracted row that names nobody and gives no reason", async () => {
    const { raw, noteId } = await noteWithTwoRevisions();
    // The shape check binds both ways: a withdrawal with no record is not expressible, and neither
    // is a live note carrying one.
    expect(() =>
      raw.prepare("UPDATE matter_note SET state = 'retracted' WHERE id = ?").run(noteId),
    ).toThrow(/constraint/iu);
  });
});

import { describe, expect, it } from "vitest";
import { createMatterNote, retractMatterNote, reviseMatterNote } from "../src/note-service.ts";
import {
  readMatterNote,
  readMatterNoteDetail,
  readMatterNoteRevisions,
  selectMatterNotesStatement,
  type MatterNoteDisplayRow,
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
  seedFirm,
  tickingClock,
  visibility,
} from "./support.ts";
import type { MatterNoteId } from "@magna-carta/identifiers/types";

const BODY = "Spoke to Mrs Herrera on Tuesday. She is thinking about the offer.";

// The matter's note list, as every read below asks for it.
async function listFor(
  database: Parameters<typeof selectMatterNotesStatement>[0],
  search?: string,
): Promise<readonly MatterNoteDisplayRow[]> {
  const { results } = await selectMatterNotesStatement(database, MATTER, {
    limit: 50,
    visibility,
    search,
  }).all<MatterNoteDisplayRow>();
  return results;
}

async function writeNote(body = BODY) {
  const { database, raw } = migratedDatabase();
  seedFirm(raw);
  const created = createMatterNote(database, { matterId: MATTER, body }, options);
  await commit(database, created.effect);
  return { database, raw, noteId: created.noteId };
}

describe("writing a note", () => {
  it("records the matter, the author, the instant and the first body", async () => {
    const { database, noteId } = await writeNote();
    const note = await readMatterNoteDetail(database, noteId, visibility);
    expect(note?.matter_id).toBe(MATTER);
    expect(note?.author_user_id).toBe(ACTOR);
    expect(note?.state).toBe("active");
    expect(note?.head_ordinal).toBe(1);
    expect(note?.body).toBe(BODY);
  });

  it("trims the edges and keeps the paragraph breaks inside", async () => {
    const { database, noteId } = await writeNote("  first thought\n\nsecond thought  ");
    const note = await readMatterNoteDetail(database, noteId, visibility);
    expect(note?.body).toBe("first thought\n\nsecond thought");
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

describe("correcting a note", () => {
  it("keeps every prior body and moves the head onto the newest", async () => {
    const { database, noteId } = await writeNote("Spoke to Mrs Herrara.");
    const clock = tickingClock();
    for (const body of ["Spoke to Mrs Herrera.", "Spoke to Mrs Herrera about the offer."]) {
      const { effect } = await reviseMatterNote(database, noteId, { body }, { ...options, clock });
      await commit(database, effect);
    }

    const note = await readMatterNoteDetail(database, noteId, visibility);
    expect(note?.head_ordinal).toBe(3);
    expect(note?.body).toBe("Spoke to Mrs Herrera about the offer.");

    // The round trip the design asks for: every body the note ever had is still readable, in order,
    // and the misspelling that started it is still there.
    const chain = await readMatterNoteRevisions(database, noteId, { limit: 100, visibility });
    expect(chain.capped).toBe(false);
    expect(chain.revisions.map((revision) => revision.body)).toEqual([
      "Spoke to Mrs Herrara.",
      "Spoke to Mrs Herrera.",
      "Spoke to Mrs Herrera about the offer.",
    ]);
    expect(chain.revisions.map((revision) => revision.ordinal)).toEqual([1, 2, 3]);
  });

  it("attributes a correction to whoever made it, not to the note's author", async () => {
    const { database, noteId } = await writeNote();
    const { effect } = await reviseMatterNote(
      database,
      noteId,
      { body: "Corrected by a colleague." },
      { ...options, actorUserId: COLLEAGUE, clock: tickingClock() },
    );
    await commit(database, effect);

    const note = await readMatterNoteDetail(database, noteId, visibility);
    // The note still belongs to whoever started it; the words showing belong to whoever wrote them.
    expect(note?.author_user_id).toBe(ACTOR);
    expect(note?.revision_author_user_id).toBe(COLLEAGUE);
  });

  it("refuses to revise a note that is not this firm's", async () => {
    const { database } = await writeNote();
    await expect(
      reviseMatterNote(
        database,
        "matterNote_absent0000000000000" as MatterNoteId,
        { body: "x" },
        options,
      ),
    ).rejects.toThrow(NoteValidationError);
  });
});

describe("withdrawing a note", () => {
  it("stops the body rendering and keeps the record of who withdrew it and why", async () => {
    const { database, noteId } = await writeNote();
    const { effect } = await retractMatterNote(
      database,
      noteId,
      { reason: "Contains another client's privileged material, typed in error." },
      { ...options, actorUserId: COLLEAGUE, clock: tickingClock() },
    );
    await commit(database, effect);

    const note = await readMatterNoteDetail(database, noteId, visibility);
    expect(note?.state).toBe("retracted");
    // The READ nulls the body, not the caller. A surface that forgot to check the state gets
    // nothing to display rather than something it should not have.
    expect(note?.body).toBeNull();
    expect(note?.retracted_by).toBe(COLLEAGUE);
    expect(note?.retraction_reason).toBe(
      "Contains another client's privileged material, typed in error.",
    );
    expect(note?.retracted_at).not.toBeNull();
  });

  it("keeps the row and every revision: nothing is deleted", async () => {
    const { database, raw, noteId } = await writeNote();
    const { effect: revised } = await reviseMatterNote(
      database,
      noteId,
      { body: "A second version." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, revised);
    const { effect } = await retractMatterNote(
      database,
      noteId,
      { reason: "Withdrawn." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);

    const rows = raw
      .prepare("SELECT COUNT(*) AS count FROM matter_note_revision WHERE note_id = ?")
      .get(noteId) as { count: number };
    expect(rows.count).toBe(2);
  });

  it("refuses a withdrawal with no reason, and a second withdrawal", async () => {
    const { database, noteId } = await writeNote();
    await expect(retractMatterNote(database, noteId, { reason: "   " }, options)).rejects.toThrow(
      NoteValidationError,
    );

    const { effect } = await retractMatterNote(
      database,
      noteId,
      { reason: "Withdrawn." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);
    // The first withdrawal's actor, instant and reason are the record and are not rewritten.
    await expect(
      retractMatterNote(database, noteId, { reason: "Withdrawn again." }, options),
    ).rejects.toThrow(NoteValidationError);
  });

  it("refuses to revise a withdrawn note", async () => {
    const { database, noteId } = await writeNote();
    const { effect } = await retractMatterNote(
      database,
      noteId,
      { reason: "Withdrawn." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);
    await expect(
      reviseMatterNote(database, noteId, { body: "New words." }, options),
    ).rejects.toThrow(NoteValidationError);
  });
});

describe("the matter's note list", () => {
  it("returns a withdrawn note as a tombstone, with its reason and without its words", async () => {
    const { database, noteId } = await writeNote("The words that came down.");
    const { effect } = await retractMatterNote(
      database,
      noteId,
      { reason: "Wrong matter." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);

    const rows = await listFor(database);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("retracted");
    expect(rows[0]?.body).toBeNull();
    expect(rows[0]?.retraction_reason).toBe("Wrong matter.");
  });

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

    // The holding matter carries a system key, so the visible-matter predicate excludes it from
    // every read that composes it — including this one.
    const holding = await selectMatterNotesStatement(database, HOLDING_MATTER, {
      limit: 50,
      visibility,
    }).all<MatterNoteDisplayRow>();
    expect(holding.results).toHaveLength(0);
    // The row really is there; it is the predicate that is keeping it out, not an empty table.
    const stored = raw
      .prepare("SELECT COUNT(*) AS count FROM matter_note WHERE matter_id = ?")
      .get(HOLDING_MATTER) as { count: number };
    expect(stored.count).toBe(1);
  });
});

describe("finding a note again", () => {
  it("matches the current text and not a body the firm corrected away", async () => {
    const { database, noteId } = await writeNote("Client says Nowak was driving.");
    expect(await listFor(database, "Nowak")).toHaveLength(1);

    const { effect } = await reviseMatterNote(
      database,
      noteId,
      { body: "Client says Novak was driving." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);

    // The correction fixed what the note says AND what it discloses. Searching the name that was
    // taken out finds nothing; the new one finds it.
    expect(await listFor(database, "Nowak")).toHaveLength(0);
    expect(await listFor(database, "Novak")).toHaveLength(1);

    // And the superseded body is still readable from the note's own history, where somebody has
    // already chosen to look at this note.
    const chain = await readMatterNoteRevisions(database, noteId, { limit: 100, visibility });
    expect(chain.revisions[0]?.body).toContain("Nowak");
  });

  it("never matches a withdrawn note", async () => {
    const { database, noteId } = await writeNote("Findable words.");
    expect(await listFor(database, "Findable")).toHaveLength(1);
    const { effect } = await retractMatterNote(
      database,
      noteId,
      { reason: "Withdrawn." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);
    expect(await listFor(database, "Findable")).toHaveLength(0);
  });

  it("treats a wildcard in the term as text a lawyer typed, not as an instruction", async () => {
    const { database } = await writeNote("Fee split is 50% to co-counsel.");
    const clock = tickingClock();
    const other = createMatterNote(
      database,
      { matterId: MATTER, body: "No percentage in this one." },
      { ...options, clock },
    );
    await commit(database, other.effect);

    // "50%" is a literal. Unescaped, the trailing % would match anything after "50" and the term
    // would be a prefix search the writer never asked for.
    expect(await listFor(database, "50%")).toHaveLength(1);
    // And a bare "%" searches for a percent SIGN — it finds the note that contains one and not the
    // note that does not, rather than matching everything the way a wildcard would.
    const percentMatches = await listFor(database, "%");
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
    // The column does not null, repoint, or anonymize when a member leaves. That they have left is
    // a JOIN on member.status at read time, which is why the note itself needs no column for it.
    expect(note?.author_user_id).toBe("user_noteDeparted00");
    const member = raw
      .prepare("SELECT status FROM member WHERE user_id = ?")
      .get("user_noteDeparted00") as { status: string };
    expect(member.status).toBe("deactivated");
  });
});

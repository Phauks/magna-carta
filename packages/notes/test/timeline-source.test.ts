import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { describe, expect, it } from "vitest";
import { readTimelinePage } from "@magna-carta/calendar/timeline";
import { timelineSourceRegistry } from "@magna-carta/calendar/sources/all";
import { createMatterNote, deleteMatterNote, editMatterNote } from "../src/note-service.ts";
import {
  MATTER,
  commit,
  migratedDatabase,
  options,
  seedFirm,
  tickingClock,
  visibility,
} from "./support.ts";

// The note as a declared source on the calendar's federated read.
//
// A note joins the timeline as ONE MORE DECLARATION, which is the whole reason there is no second
// activity stream in this platform: the timeline is the register, so a note appears on it by being
// read in place out of its own table. Nothing here writes a projection, and nothing in
// packages/notes knows the timeline exists.

async function timelineFor(database: Parameters<typeof readTimelinePage>[0]["database"]) {
  return readTimelinePage({
    database,
    registry: timelineSourceRegistry(),
    scope: { matterId: MATTER },
    visibility,
    pageSize: 50,
    ascending: false,
  });
}

async function seededNote(
  body = "Counsel's theory is that the indemnity survives termination.",
  occurredOn?: string,
) {
  const { database, raw } = migratedDatabase();
  seedFirm(raw);
  const created = createMatterNote(database, { matterId: MATTER, body, occurredOn }, options);
  await commit(database, created.effect);
  return { database, raw, noteId: created.noteId };
}

describe("a note on the matter timeline", () => {
  it("appears as one entry, carrying its actor and no words", async () => {
    const { database } = await seededNote();
    const entries = (await timelineFor(database)).entries.filter(
      (entry) => entry.sourceKey === "matterNote",
    );
    expect(entries).toHaveLength(1);
    // The label is the disclosure this source refuses. A note body's first eight words are
    // frequently the whole disclosure, and the timeline spans every matter.
    expect(entries[0]?.label).toBeNull();
    expect(entries[0]?.actorUserId).toBe(options.actorUserId);
    expect(entries[0]?.link).toContain("/notes");
    expect(JSON.stringify(entries[0])).not.toContain("indemnity");
  });

  it("sits on the day it happened, not the day it was typed", async () => {
    const { database } = await seededNote("Call with the client.", "2026-08-25");
    const entries = (await timelineFor(database)).entries.filter(
      (entry) => entry.sourceKey === "matterNote",
    );
    // The sort key is the occurrence, so the note lands beside whatever else happened that day
    // rather than beside the moment somebody wrote it down.
    expect(entries[0]?.sortKey).toBe("2026-08-25");
  });

  it("falls back to the written day when the note names no occurrence", async () => {
    const { database } = await seededNote("No date on this one.");
    const entries = (await timelineFor(database)).entries.filter(
      (entry) => entry.sourceKey === "matterNote",
    );
    // A civil date cut from the created instant, never the instant itself: one column, one shape.
    expect(entries[0]?.sortKey).toMatch(CIVIL_DATE_PATTERN);
  });

  it("stays ONE entry after an edit, and moves when the edit moves the occurrence", async () => {
    const { database, noteId } = await seededNote("The first account.", "2026-08-10");
    const { effect } = await editMatterNote(
      database,
      noteId,
      { body: "A corrected account.", occurredOn: "2026-08-11" },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);

    const entries = (await timelineFor(database)).entries.filter(
      (entry) => entry.sourceKey === "matterNote",
    );
    expect(entries).toHaveLength(1);
    // Correcting the day the call happened corrects where it sits, which is the point of recording
    // the occurrence separately at all.
    expect(entries[0]?.sortKey).toBe("2026-08-11");
  });

  it("leaves the timeline when the note is deleted", async () => {
    const { database, noteId } = await seededNote();
    expect(
      (await timelineFor(database)).entries.some((entry) => entry.sourceKey === "matterNote"),
    ).toBe(true);

    const { effect } = await deleteMatterNote(database, noteId, {
      ...options,
      clock: tickingClock(),
    });
    await commit(database, effect);

    // Nothing filters it out: the row is gone, so the source has nothing to read.
    expect(
      (await timelineFor(database)).entries.some((entry) => entry.sourceKey === "matterNote"),
    ).toBe(false);
  });

  it("costs the page exactly one statement, however many notes the matter has", async () => {
    const { database } = await seededNote();
    const clock = tickingClock();
    for (const body of ["A second note.", "A third note.", "A fourth note."]) {
      const created = createMatterNote(database, { matterId: MATTER, body }, { ...options, clock });
      await commit(database, created.effect);
    }
    const registry = timelineSourceRegistry();
    const withoutNotes = registry
      .all()
      .map((source) => source.key)
      .filter((key) => key !== "matterNote");

    const all = await readTimelinePage({
      database,
      registry,
      scope: { matterId: MATTER },
      visibility,
      pageSize: 50,
      ascending: false,
    });
    const others = await readTimelinePage({
      database,
      registry,
      scope: { matterId: MATTER },
      visibility,
      pageSize: 50,
      ascending: false,
      sourceKeys: withoutNotes,
    });

    // The bound the design asks for: adding this source raises the page's statement count by
    // EXACTLY ONE, and four notes cost the same as one. That is the line between a bounded fan-out
    // and an N+1 — N here is the number of declared sources, fixed in code.
    expect(all.statementCount).toBe(others.statementCount + 1);
    expect(all.entries.filter((entry) => entry.sourceKey === "matterNote")).toHaveLength(4);
  });

  it("is a read-side declaration only: no note write touches the calendar's tables", async () => {
    const { database, raw, noteId } = await seededNote();
    const { effect } = await editMatterNote(
      database,
      noteId,
      { body: "Corrected." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);

    for (const table of ["matter_event", "matter_deadline", "firm_event", "calendar_event_link"]) {
      const row = raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      expect(row.count, table).toBe(0);
    }
  });
});

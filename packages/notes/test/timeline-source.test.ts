import { describe, expect, it } from "vitest";
import { readTimelinePage } from "@magna-carta/calendar/timeline";
import { timelineSourceRegistry } from "@magna-carta/calendar/sources/all";
import { createMatterNote, retractMatterNote, reviseMatterNote } from "../src/note-service.ts";
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

async function seededNote(body = "Counsel's theory is that the indemnity survives termination.") {
  const { database, raw } = migratedDatabase();
  seedFirm(raw);
  const created = createMatterNote(database, { matterId: MATTER, body }, options);
  await commit(database, created.effect);
  return { database, raw, noteId: created.noteId };
}

describe("a note on the matter timeline", () => {
  it("appears as one entry, carrying its actor and no words", async () => {
    const { database } = await seededNote();
    const page = await timelineFor(database);
    const entries = page.entries.filter((entry) => entry.sourceKey === "matterNote");
    expect(entries).toHaveLength(1);
    // The label is the disclosure this source refuses. A note body's first eight words are
    // frequently the whole disclosure, and the timeline spans every matter.
    expect(entries[0]?.label).toBeNull();
    expect(entries[0]?.actorUserId).toBe(options.actorUserId);
    expect(entries[0]?.link).toContain("/notes");
    // Nothing on the entry carries the text, under any key.
    expect(JSON.stringify(entries[0])).not.toContain("indemnity");
  });

  it("stays ONE entry after the note is corrected, and does not move up the history", async () => {
    const { database, noteId } = await seededNote("The first account.");
    const before = await timelineFor(database);
    const original = before.entries.find((entry) => entry.sourceKey === "matterNote");

    const clock = tickingClock();
    for (const body of ["The second account.", "The third account."]) {
      const { effect } = await reviseMatterNote(database, noteId, { body }, { ...options, clock });
      await commit(database, effect);
    }

    const after = await timelineFor(database);
    const entries = after.entries.filter((entry) => entry.sourceKey === "matterNote");
    // A source over the revision table would put a fresh entry on the timeline every time somebody
    // fixed a typo, each claiming to be a thing that happened.
    expect(entries).toHaveLength(1);
    // And the sort key is the note's own created instant, so a contemporaneous record stays at the
    // moment it was written rather than jumping to the top when it is corrected.
    expect(entries[0]?.sortKey).toBe(original?.sortKey);
  });

  it("leaves the timeline entirely once withdrawn", async () => {
    const { database, noteId } = await seededNote();
    expect((await timelineFor(database)).entries.some((e) => e.sourceKey === "matterNote")).toBe(
      true,
    );

    const { effect } = await retractMatterNote(
      database,
      noteId,
      { reason: "Wrong matter." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);

    // Excluded rather than tombstoned here, deliberately: the matter's own notes surface is where a
    // withdrawal is visible and actionable, while an entry on a read spanning every matter would be
    // an unexplained gap at best and a pointer at the withdrawal at worst.
    expect((await timelineFor(database)).entries.some((e) => e.sourceKey === "matterNote")).toBe(
      false,
    );
  });

  it("costs the page exactly one statement, however many notes the matter has", async () => {
    const { database } = await seededNote();
    const clock = tickingClock();
    for (const body of ["A second note.", "A third note.", "A fourth note."]) {
      const created = createMatterNote(database, { matterId: MATTER, body }, { ...options, clock });
      await commit(database, created.effect);
    }

    const registry = timelineSourceRegistry();
    const everySourceKey = registry.all().map((source) => source.key);
    const withoutNotes = everySourceKey.filter((key) => key !== "matterNote");

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
    const { effect } = await reviseMatterNote(
      database,
      noteId,
      { body: "Corrected." },
      { ...options, clock: tickingClock() },
    );
    await commit(database, effect);

    // A source is never a write-side obligation on the subsystem that owns the rows. Writing a note
    // records a note and an audit row, and nothing anywhere else.
    for (const table of ["matter_event", "matter_deadline", "firm_event", "calendar_event_link"]) {
      const row = raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      expect(row.count, table).toBe(0);
    }
  });
});

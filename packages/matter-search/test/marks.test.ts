import { describe, expect, it } from "vitest";
import { runSearchAcrossMatters } from "../src/run-across-matters.ts";
import { runMatterSearch } from "../src/run.ts";
import { withMarks } from "../src/marks.ts";
import { matterSearchSources } from "../src/sources/all.ts";
import type { MatterSearchHit } from "../src/types.ts";
import {
  ALL_PERMISSIONS,
  MATTER,
  OTHER_MATTER,
  seededDatabase,
  seedFile,
  seedNote,
  visibility,
} from "./support.ts";

// Where a reader's words are in a result: what each source marks, and what a long text is cut to.
//
// The marking is the last step of both searches and decides nothing, so what is pinned here is
// what a reader sees: the words that answered are marked, a text that is not what matched is left
// alone, and a long note is quoted at its match instead of at its opening.

const LONG_NOTE =
  "Called the surveyor on Tuesday about the north line. He will walk the parcel next week and " +
  "send the plat. Separately, the clerk confirmed the hearing stays on calendar. On the main " +
  "question the surveyor confirms the boundary monument sits inside the Hargrove well house, " +
  "not beside it, which is what the 1987 agreement describes. He will put that in writing.";

function markedIn(text: string | null, marks: readonly { start: number; end: number }[]): string[] {
  return marks.map((mark) => (text ?? "").slice(mark.start, mark.end));
}

function hit(overrides: Partial<MatterSearchHit>): MatterSearchHit {
  return {
    sourceKey: "notes",
    id: "row",
    matterId: MATTER,
    title: "2026-07-14",
    titleMarks: [],
    snippet: null,
    snippetMarks: [],
    secondary: null,
    actorUserId: null,
    sortKey: "2026-07-14",
    link: "/matters/x/notes?entry=row",
    ...overrides,
  };
}

describe("what each kind of match marks", () => {
  it("marks a record's words in its text and leaves a title that is a date alone", () => {
    const marked = withMarks(
      { title: null, snippet: "record-words" },
      hit({ title: "2026-07-14", snippet: "Hearing moved to 2026-07-14 on the easement." }),
      "easement 2026",
    );
    expect(marked.titleMarks).toEqual([]);
    expect(markedIn(marked.snippet, marked.snippetMarks)).toEqual(["2026", "easement"]);
  });

  it("marks a name by the characters typed", () => {
    const marked = withMarks(
      { title: "characters", snippet: null },
      hit({ title: "Invoice 2026-0142-A.pdf" }),
      "0142",
    );
    expect(markedIn(marked.title, marked.titleMarks)).toEqual(["0142"]);
  });

  it("marks a file's sentence and not its name when the words were inside the file", () => {
    const marked = withMarks(
      { title: null, snippet: "file-words" },
      hit({
        title: "Easement agreement.pdf",
        snippet: "…conveys a perpetual easement twenty feet…",
      }),
      "easement",
    );
    expect(marked.titleMarks).toEqual([]);
    expect(markedIn(marked.snippet, marked.snippetMarks)).toEqual(["easement"]);
  });

  it("answers no marks for a hit with no excerpt", () => {
    const marked = withMarks({ title: null, snippet: "record-words" }, hit({}), "easement");
    expect(marked.snippet).toBeNull();
    expect(marked.snippetMarks).toEqual([]);
  });
});

describe("a matter's own search marks what it shows", () => {
  it("quotes a long note at the stretch the words are in and marks them", async () => {
    const { database, raw } = seededDatabase();
    seedNote(raw, { id: "matterNote_long", matterId: MATTER, body: LONG_NOTE });
    const answer = await runMatterSearch({
      database,
      registry: matterSearchSources,
      matterId: MATTER,
      query: "hargrove monument",
      visibility,
      sourceKeys: ["notes"],
      permissions: ALL_PERMISSIONS,
      limit: 10,
      includeDeleted: false,
    });
    const [note] = answer.groups[0]?.hits ?? [];
    expect(note?.id).toBe("matterNote_long");
    expect(note?.snippet).toContain("the boundary monument sits inside the Hargrove well house");
    expect(note?.snippet?.startsWith("…")).toBe(true);
    expect(note?.snippet).not.toContain("Called the surveyor");
    expect(markedIn(note?.snippet ?? null, note?.snippetMarks ?? [])).toEqual([
      "monument",
      "Hargrove",
    ]);
    // The title is the day the note is about, and nothing in it is marked.
    expect(note?.titleMarks).toEqual([]);
  });

  it("shows a short note whole and marks a word found by its start", async () => {
    const { database } = seededDatabase();
    const answer = await runMatterSearch({
      database,
      registry: matterSearchSources,
      matterId: MATTER,
      query: "ease",
      visibility,
      sourceKeys: ["notes"],
      permissions: ALL_PERMISSIONS,
      limit: 10,
      includeDeleted: false,
    });
    const hits = answer.groups[0]?.hits ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const found of hits) {
      expect(markedIn(found.snippet, found.snippetMarks)).toEqual(["easement"]);
    }
    expect(hits.map((found) => found.snippet)).toContain("The easement runs east.");
  });

  it("marks a file name by the characters typed, in the middle of a word", async () => {
    const { database } = seededDatabase();
    const answer = await runMatterSearch({
      database,
      registry: matterSearchSources,
      matterId: MATTER,
      query: "sement sur",
      visibility,
      sourceKeys: ["files"],
      permissions: ALL_PERMISSIONS,
      limit: 10,
      includeDeleted: false,
    });
    const survey = (answer.groups[0]?.hits ?? []).find((found) => found.id === "file_survey");
    expect(markedIn(survey?.title ?? null, survey?.titleMarks ?? [])).toEqual(["sement sur"]);
  });
});

describe("the search across matters marks what it shows", () => {
  it("marks the words in each matter's records and the characters in each file name", async () => {
    const { database, raw } = seededDatabase();
    seedNote(raw, { id: "matterNote_longOther", matterId: OTHER_MATTER, body: LONG_NOTE });
    seedFile(raw, { id: "file_other", matterId: OTHER_MATTER, name: "Monument photographs.zip" });
    const answer = await runSearchAcrossMatters({
      database,
      registry: matterSearchSources,
      query: "monument",
      visibility,
      sourceKeys: ["notes", "files"],
      permissions: ALL_PERMISSIONS,
      limit: 10,
    });
    const notes = answer.groups.find((group) => group.source === "notes")?.hits ?? [];
    const files = answer.groups.find((group) => group.source === "files")?.hits ?? [];
    expect(notes.map((found) => found.id)).toEqual(["matterNote_longOther"]);
    expect(markedIn(notes[0]?.snippet ?? null, notes[0]?.snippetMarks ?? [])).toEqual(["monument"]);
    expect(notes[0]?.snippet?.length ?? 0).toBeLessThan(LONG_NOTE.length);
    expect(files.map((found) => found.id)).toEqual(["file_other"]);
    expect(markedIn(files[0]?.title ?? null, files[0]?.titleMarks ?? [])).toEqual(["Monument"]);
  });
});

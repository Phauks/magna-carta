import { describe, expect, it } from "vitest";
import { runMatterSearch } from "../src/run.ts";
import { matterSearchSources } from "../src/sources/all.ts";
import type { MatterSearchGroup } from "../src/types.ts";
import { ALL_PERMISSIONS, MATTER, NO_PERMISSIONS, seededDatabase, visibility } from "./support.ts";

async function search(
  query: string,
  overrides: {
    sourceKeys?: readonly string[];
    permissions?: ReadonlySet<never> | typeof ALL_PERMISSIONS;
    limit?: number;
    includeDeleted?: boolean;
  } = {},
) {
  const { database } = seededDatabase();
  return runMatterSearch({
    database,
    registry: matterSearchSources,
    matterId: MATTER,
    query,
    visibility,
    sourceKeys: overrides.sourceKeys,
    permissions: overrides.permissions ?? ALL_PERMISSIONS,
    limit: overrides.limit ?? 10,
    includeDeleted: overrides.includeDeleted ?? false,
  });
}

function group(groups: readonly MatterSearchGroup[], key: string): MatterSearchGroup {
  const found = groups.find((candidate) => candidate.source === key);
  if (found === undefined) throw new Error(`no group for source ${key}`);
  return found;
}

function titles(groups: readonly MatterSearchGroup[], key: string): string[] {
  return group(groups, key).hits.map((hit) => hit.title);
}

describe("a matter search answers from every section at once", () => {
  it("returns a group per source, in the section strip's order", async () => {
    const answer = await search("easement");
    // Registry order, derived rather than listed — the assertion is that the ANSWER reads in the
    // same order as the matter's own section strip, not that the registry holds four things.
    expect(answer.groups.map((entry) => entry.source)).toEqual(
      matterSearchSources.all().map((source) => source.key),
    );
  });

  it("finds the record across four different subsystems from one query", async () => {
    const answer = await search("easement");
    expect(titles(answer.groups, "files")).toEqual(["Easement survey.pdf", "Easement exhibits"]);
    expect(titles(answer.groups, "custody")).toEqual(["Original easement deed"]);
    expect(group(answer.groups, "notes").hits[0]?.snippet).toBe("The easement runs east.");
  });

  it("carries a link into the section that owns the row", async () => {
    const answer = await search("easement");
    expect(group(answer.groups, "files").hits[0]?.link).toBe(
      `/matters/${MATTER}/files?entry=file_survey`,
    );
    expect(group(answer.groups, "custody").hits[0]?.link).toBe(
      `/matters/${MATTER}/custodian?entry=custodyPacket_deed`,
    );
  });

  it("matches a party on their name and reports what they are to the matter", async () => {
    const answer = await search("easton");
    const hit = group(answer.groups, "parties").hits[0];
    expect(hit?.title).toBe("Marta Easton");
    expect(hit?.secondary).toBe("opposing_party · Trustee");
  });
});

describe("the files source answers for folders as well as files", () => {
  it("finds a folder by the name somebody gave it", async () => {
    // The reported defect, as a test: a folder named and then searched for answered nothing,
    // because the source queried file names and joined folders only to label a file's location.
    const answer = await search("exhibits");
    expect(titles(answer.groups, "files")).toEqual(["Easement exhibits"]);
  });

  it("says a folder is a folder, so a same-named file and folder are told apart", async () => {
    const answer = await search("exhibits");
    expect(group(answer.groups, "files").hits[0]?.secondary).toBe("Folder");
  });

  it("answers for both in one group rather than splitting the question in two", async () => {
    const answer = await search("easement");
    const files = group(answer.groups, "files");
    expect(files.hits.map((hit) => hit.id)).toEqual(["file_survey", "folder_exhibits"]);
    expect(files.matchedFields).toEqual(["file names", "folder names"]);
  });

  it("keeps another matter's folder out, exactly as it keeps its files out", async () => {
    const answer = await search("bundle");
    expect(titles(answer.groups, "files")).toEqual([]);
  });

  it("leaves folders alone when deleted files are asked for, having no deleted set", async () => {
    // A folder is removed outright rather than soft-deleted, so the option changes the file
    // statement and not this one. Asking for deleted records must not drop the folder either.
    const answer = await search("easement", { includeDeleted: true });
    expect(titles(answer.groups, "files")).toContain("Easement exhibits");
    expect(titles(answer.groups, "files")).toContain("Easement draft (superseded).pdf");
  });

  it("merges the two statements by sort key rather than concatenating them", async () => {
    /*
     * The bug this pins: each statement sorts and limits its OWN rows, so concatenating them lets a
     * first statement that fills the limit push every row of the second out of the group entirely.
     * At a limit of one, the files statement alone returns two rows — without the merge in run.ts
     * the folder could never place, whatever its date.
     */
    const answer = await search("easement", { limit: 1 });
    const files = group(answer.groups, "files");
    expect(files.hits).toHaveLength(1);
    expect(files.hasMore).toBe(true);
  });
});

// The properties about what does NOT come back. Every one of these passes trivially on a fixture
// with one matter in it, which is why the fixture has three.
describe("a matter search never leaves its matter", () => {
  it("excludes another matter's rows carrying the same words", async () => {
    const answer = await search("easement");
    const everyId = answer.groups.flatMap((entry) => entry.hits.map((hit) => hit.id));
    expect(everyId).not.toContain("matterNote_decoy");
    expect(everyId).not.toContain("file_decoy");
    expect(everyId).not.toContain("custodyPacket_decoy");
  });

  it("excludes the platform-owned holding matter, which no read may surface", async () => {
    const { database } = seededDatabase();
    const answer = await runMatterSearch({
      database,
      registry: matterSearchSources,
      // Asking for the holding matter BY ID is the read the visible-matter predicate exists to
      // refuse: it is a real row in every firm's database and it must answer nothing.
      matterId: "matter_searchHolding00000000000000" as never,
      query: "easement",
      visibility,
      sourceKeys: undefined,
      permissions: ALL_PERMISSIONS,
      limit: 10,
      includeDeleted: false,
    });
    expect(answer.groups.flatMap((entry) => entry.hits)).toEqual([]);
  });
});

describe("a note's search follows the notes package's own model", () => {
  it("matches the words the note holds, and orders by when the note is ABOUT", async () => {
    // The note about 2026-07-14 was typed on 2026-08-01. It must sort by the earlier date, because
    // that is the order the Notes tab itself uses — a search that placed it differently from the
    // list it links into would make the reader check twice.
    const answer = await search("easement");
    const notes = group(answer.groups, "notes");
    expect(notes.hits.map((hit) => hit.id)).toEqual(["matterNote_easement", "matterNote_occurred"]);
    expect(notes.hits[1]?.sortKey).toBe("2026-07-14");
  });

  it("carries the note's own words as the excerpt", async () => {
    const answer = await search("neighbour");
    expect(group(answer.groups, "notes").hits[0]?.snippet).toBe(
      "Spoke to the neighbour about the easement fence.",
    );
  });
});

describe("the reader's scope narrows the registry, not the results", () => {
  it("answers only the named source", async () => {
    const answer = await search("easement", { sourceKeys: ["files"] });
    expect(answer.groups).toHaveLength(1);
    expect(answer.groups[0]?.source).toBe("files");
  });

  it("treats an absent scope as every source the reader may read", async () => {
    const answer = await search("easement", { sourceKeys: undefined });
    expect(answer.groups).toHaveLength(matterSearchSources.all().length);
  });

  it("treats an empty scope the same way, rather than as nothing", async () => {
    const answer = await search("easement", { sourceKeys: [] });
    expect(answer.groups).toHaveLength(matterSearchSources.all().length);
  });
});

describe("a source the reader cannot read says so", () => {
  it("skips it for want of the capability rather than returning it empty", async () => {
    const answer = await search("easement", { permissions: NO_PERMISSIONS });
    expect(group(answer.groups, "notes").skipped).toBe("permission");
    expect(group(answer.groups, "custody").skipped).toBe("permission");
    // "Nothing matched" and "you cannot see this" must never look alike: the ungated sources still
    // answer, and they answer with hits. Two, because reading a matter's files is ungated and the
    // source answers for its folders in the same group — the file and the folder both match.
    expect(group(answer.groups, "files").skipped).toBeNull();
    expect(group(answer.groups, "files").hits).toHaveLength(2);
  });

  it("issues no statement at all for a withheld source", async () => {
    const { database } = seededDatabase();
    const issued: string[] = [];
    const watched = {
      prepare: (sql: string) => {
        issued.push(sql);
        return database.prepare(sql);
      },
    };
    await runMatterSearch({
      database: watched,
      registry: matterSearchSources,
      matterId: MATTER,
      query: "easement",
      visibility,
      sourceKeys: undefined,
      permissions: NO_PERMISSIONS,
      limit: 10,
      includeDeleted: false,
    });
    // A post-filter would have run the query and thrown the rows away. Nothing here names either
    // gated table.
    expect(issued.some((sql) => sql.includes("matter_note"))).toBe(false);
    expect(issued.some((sql) => sql.includes("custody_packet"))).toBe(false);
  });
});

describe("a query too short to answer says so rather than answering emptily", () => {
  it("marks every source skipped below its minimum", async () => {
    const answer = await search("e");
    for (const entry of answer.groups) {
      expect(entry.skipped).toBe("query-too-short");
      expect(entry.hits).toEqual([]);
    }
  });
});

describe("the reader's text is text, never an instruction", () => {
  it("does not let a wildcard in the query match anything", async () => {
    const { database, raw } = seededDatabase();
    raw.exec(
      `INSERT INTO file (id, matter_id, folder_id, name, edit_state, deleted_at, created_at, updated_at) ` +
        `VALUES ('file_percent', '${MATTER}', NULL, '50% contingency.pdf', 'idle', NULL, ` +
        `'2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
    );
    const answer = await runMatterSearch({
      database,
      registry: matterSearchSources,
      matterId: MATTER,
      // Unescaped, "50%" is "starts with 50, then anything" and would also drag in nothing here —
      // but "%.pdf" would match every file in the matter. Escaped, it matches the one file whose
      // name genuinely contains the characters.
      query: "%.pdf",
      visibility,
      sourceKeys: ["files"],
      permissions: ALL_PERMISSIONS,
      limit: 10,
      includeDeleted: false,
    });
    expect(group(answer.groups, "files").hits).toEqual([]);

    const literal = await runMatterSearch({
      database,
      registry: matterSearchSources,
      matterId: MATTER,
      query: "50%",
      visibility,
      sourceKeys: ["files"],
      permissions: ALL_PERMISSIONS,
      limit: 10,
      includeDeleted: false,
    });
    expect(literal.groups[0]?.hits.map((hit) => hit.title)).toEqual(["50% contingency.pdf"]);
  });
});

describe("deleted records join an answer only when asked for, and only where declared", () => {
  it("leaves a deleted file out by default", async () => {
    const answer = await search("easement");
    expect(titles(answer.groups, "files")).toEqual(["Easement survey.pdf", "Easement exhibits"]);
  });

  it("includes it when asked, so it can be restored rather than hunted for", async () => {
    const answer = await search("easement", { includeDeleted: true });
    expect(titles(answer.groups, "files")).toContain("Easement draft (superseded).pdf");
  });

  it("marks a deleted file rather than returning it looking live", async () => {
    // The failure this prevents is not a missing badge: it is somebody acting on a document that is
    // no longer in the matter because the row read exactly like the live ones beside it.
    const answer = await search("easement", { includeDeleted: true });
    const deleted = group(answer.groups, "files").hits.find(
      (hit) => hit.title === "Easement draft (superseded).pdf",
    );
    expect(deleted?.secondary).toContain("Deleted");
    const live = group(answer.groups, "files").hits.find(
      (hit) => hit.title === "Easement survey.pdf",
    );
    expect(live?.secondary ?? "").not.toContain("Deleted");
  });

  it("tells a caller which sources could honor the option at all", async () => {
    // On the wire so the browser never keeps its own list of which sources have deleted sets — a
    // second place that knows what the registry knows, free to fall behind it.
    const answer = await search("easement");
    expect(group(answer.groups, "files").supportsDeleted).toBe(true);
    expect(group(answer.groups, "notes").supportsDeleted).toBe(false);
  });

  it("never hands the flag to a source that has not declared it can honor one", async () => {
    // A retracted note stays unmatchable whatever a caller asks for. The flag is filtered by the
    // runner against the source's declaration, so this is a property of the machinery rather than
    // of the notes source remembering to ignore it.
    const answer = await search("misdescribed", { includeDeleted: true });
    expect(group(answer.groups, "notes").hits).toEqual([]);
  });
});

describe("a group reports more without claiming a total it did not count", () => {
  it("measures has-more by reading one row past the limit", async () => {
    const { database, raw } = seededDatabase();
    for (let index = 0; index < 5; index++) {
      raw.exec(
        `INSERT INTO file (id, matter_id, folder_id, name, edit_state, deleted_at, created_at, updated_at) ` +
          `VALUES ('file_bulk${index}', '${MATTER}', NULL, 'Easement exhibit ${index}.pdf', 'idle', NULL, ` +
          `'2026-08-0${index + 2}T00:00:00.000Z', '2026-08-0${index + 2}T00:00:00.000Z')`,
      );
    }
    const answer = await runMatterSearch({
      database,
      registry: matterSearchSources,
      matterId: MATTER,
      query: "easement",
      visibility,
      sourceKeys: ["files"],
      permissions: ALL_PERMISSIONS,
      limit: 3,
      includeDeleted: false,
    });
    const files = group(answer.groups, "files");
    expect(files.hits).toHaveLength(3);
    expect(files.hasMore).toBe(true);
  });

  it("reports no more when the answer fits", async () => {
    const answer = await search("easement", { sourceKeys: ["custody"] });
    expect(group(answer.groups, "custody").hasMore).toBe(false);
  });
});

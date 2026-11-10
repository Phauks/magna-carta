import { describe, expect, it } from "vitest";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  arrangeByCandidates,
  candidatesFrom,
  pageNote,
  passagesToAskFor,
  type FileContentsAnswer,
  type FileContentsPassage,
  type MatterFileContentsSearcher,
} from "../src/file-contents.ts";
import { runMatterSearch } from "../src/run.ts";
import { matterSearchSources } from "../src/sources/all.ts";
import type { MatterSearchGroup, MatterSearchRawRow } from "../src/types.ts";
import {
  ALL_PERMISSIONS,
  MATTER,
  NO_PERMISSIONS,
  OTHER_MATTER,
  seededDatabase,
  seedFile,
  seedFolder,
  visibility,
} from "./support.ts";

// The words inside a matter's files, as a place the matter's search looks. The index is outside the
// database, so these stand a searcher in for it and pin the half that is this package's: what is
// asked, what an answer becomes, and above all that an answer is only ever a list of candidates the
// firm's own `file` table then decides on.

interface Asked {
  readonly matterId: string;
  readonly queryText: string;
  readonly limit: number;
}

function searcherAnswering(answer: FileContentsAnswer): {
  searcher: MatterFileContentsSearcher;
  asked: Asked[];
} {
  const asked: Asked[] = [];
  return {
    asked,
    searcher: {
      query: async (input) => {
        asked.push(input);
        return answer;
      },
    },
  };
}

function passages(...entries: readonly (readonly [string, number])[]): FileContentsAnswer {
  return {
    kind: "passages",
    passages: entries.map(([fileId, pageIndex]) => ({ fileId, chunkId: `page-${pageIndex}` })),
  };
}

async function search(
  database: SqlDatabase,
  query: string,
  fileContents: MatterFileContentsSearcher | null | undefined,
  options: { includeDeleted?: boolean; limit?: number; matterId?: typeof MATTER } = {},
): Promise<MatterSearchGroup> {
  const answer = await runMatterSearch({
    database,
    registry: matterSearchSources,
    matterId: options.matterId ?? MATTER,
    query,
    visibility,
    sourceKeys: ["file-contents"],
    permissions: ALL_PERMISSIONS,
    limit: options.limit ?? 25,
    includeDeleted: options.includeDeleted ?? false,
    ...(fileContents === undefined ? {} : { fileContents }),
  });
  const [group] = answer.groups;
  if (group === undefined) throw new Error("the file contents source did not answer");
  return group;
}

describe("the words inside a matter's files", () => {
  it("answers with the files the index named, best match first, each saying its pages", async () => {
    const { database, raw } = seededDatabase();
    seedFolder(raw, { id: "folder_contracts", matterId: MATTER, name: "Contracts" });
    raw.exec(
      `INSERT INTO file (id, matter_id, folder_id, name, edit_state, created_at, updated_at) VALUES ` +
        `('file_lease', '${MATTER}', 'folder_contracts', 'Ground lease.pdf', 'idle', ` +
        `'2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z')`,
    );
    // The index ranks the survey above the lease, although the lease is the newer row. A page the
    // index names twice is one page.
    const { searcher } = searcherAnswering(
      passages(["file_survey", 6], ["file_lease", 0], ["file_survey", 2], ["file_survey", 6]),
    );

    const group = await search(database, "indemnify", searcher);

    expect(group.skipped).toBeNull();
    expect(group.section).toBe("files");
    expect(group.answerShape).toBe("ranked");
    expect(group.hits.map((hit) => [hit.id, hit.title, hit.secondary])).toEqual([
      ["file_survey", "Easement survey.pdf", "Pages 3 and 7"],
      ["file_lease", "Ground lease.pdf", "Page 1 · Contracts"],
    ]);
    expect(group.hits.every((hit) => hit.snippet === null)).toBe(true);
  });

  it("asks the index a question built from the words, never the reader's own text", async () => {
    const { database } = seededDatabase();
    const { searcher, asked } = searcherAnswering(passages());

    await search(database, 'body:/.*/ OR "hold harmless" -indemn', searcher, { limit: 10 });

    expect(asked).toEqual([
      {
        matterId: MATTER,
        // Every operator the reader typed has become a word or gone; the last word is unfinished.
        queryText: '+"body" +"or" +"hold harmless" +body:/indemn.*/',
        // Eight passages for each of the eleven files wanted: the limit and the has-more probe.
        limit: 88,
      },
    ]);
  });

  it("refuses a file the index names that is filed on another matter", async () => {
    const { database } = seededDatabase();
    // An index that is wrong, or stale, or was told a lie: it names another matter's file and a
    // file that does not exist, between two that are this matter's.
    const { searcher } = searcherAnswering(
      passages(["file_decoy", 0], ["file_survey", 0], ["file_holding", 0], ["file_never", 0]),
    );

    const group = await search(database, "easement", searcher);

    expect(group.hits.map((hit) => hit.id)).toEqual(["file_survey"]);
  });

  it("answers nothing for a matter the named file is not filed on, whatever the index says", async () => {
    const { database } = seededDatabase();
    const { searcher } = searcherAnswering(passages(["file_survey", 0]));

    const group = await search(database, "easement", searcher, {
      matterId: "matter_searchNowhere00000000000000" as typeof MATTER,
    });

    expect(group.hits).toEqual([]);
  });

  it("leaves a deleted file out unless deleted items were asked for, and then marks it", async () => {
    const { database } = seededDatabase();
    const { searcher } = searcherAnswering(passages(["file_deleted", 4], ["file_survey", 0]));

    const without = await search(database, "easement", searcher);
    expect(without.hits.map((hit) => hit.id)).toEqual(["file_survey"]);

    const withDeleted = await search(database, "easement", searcher, { includeDeleted: true });
    expect(withDeleted.hits.map((hit) => [hit.id, hit.secondary])).toEqual([
      ["file_deleted", "Page 5 · Deleted"],
      ["file_survey", "Page 1"],
    ]);
  });

  it("says there is more when the index named more files than the limit", async () => {
    const { database, raw } = seededDatabase();
    for (const name of ["a", "b", "c"]) {
      seedFile(raw, { id: `file_more_${name}`, matterId: MATTER, name: `${name}.pdf` });
    }
    const { searcher } = searcherAnswering(
      passages(["file_more_b", 0], ["file_more_a", 0], ["file_more_c", 0]),
    );

    const group = await search(database, "easement", searcher, { limit: 2 });

    expect(group.hits.map((hit) => hit.id)).toEqual(["file_more_b", "file_more_a"]);
    expect(group.hasMore).toBe(true);
  });

  it("answers no matches without reading the database when the index found nothing", async () => {
    const { database } = seededDatabase();
    const { searcher } = searcherAnswering(passages());

    const group = await search(database, "easement", searcher);

    expect(group.skipped).toBeNull();
    expect(group.hits).toEqual([]);
    expect(group.hasMore).toBe(false);
  });

  it("does not ask the index when the text holds no word it could match", async () => {
    const { database } = seededDatabase();
    const { searcher, asked } = searcherAnswering(passages(["file_survey", 0]));

    const group = await search(database, '"" --', searcher);

    expect(asked).toEqual([]);
    expect(group.hits).toEqual([]);
    expect(group.skipped).toBeNull();
  });

  it("says the firm has not turned file indexing on, instead of saying nothing matched", async () => {
    const { database } = seededDatabase();
    const { searcher } = searcherAnswering({ kind: "off" });

    const group = await search(database, "easement", searcher);

    expect(group.skipped).toBe("not-indexed");
    expect(group.hits).toEqual([]);
  });

  it("says it could not be searched when the index was asked and did not answer", async () => {
    const { database } = seededDatabase();

    const unavailable = await search(
      database,
      "easement",
      searcherAnswering({ kind: "unavailable" }).searcher,
    );
    expect(unavailable.skipped).toBe("engine-unavailable");
    expect(unavailable.hits).toEqual([]);
  });

  it("says the index is not connected yet when it is not, or nothing reaches it", async () => {
    const { database } = seededDatabase();

    const notConnected = await search(
      database,
      "easement",
      searcherAnswering({ kind: "not-connected" }).searcher,
    );
    expect(notConnected.skipped).toBe("engine-not-connected");

    expect((await search(database, "easement", null)).skipped).toBe("engine-not-connected");
    expect((await search(database, "easement", undefined)).skipped).toBe("engine-not-connected");
  });

  it("is not asked for a single character", async () => {
    const { database } = seededDatabase();
    const { searcher, asked } = searcherAnswering(passages(["file_survey", 0]));

    const group = await search(database, "e", searcher);

    expect(group.skipped).toBe("query-too-short");
    expect(asked).toEqual([]);
  });

  it("is open to any member of the firm, like the file list it sits beside", async () => {
    const { database } = seededDatabase();
    const { searcher } = searcherAnswering(passages(["file_survey", 0]));

    const answer = await runMatterSearch({
      database,
      registry: matterSearchSources,
      matterId: MATTER,
      query: "easement",
      visibility,
      sourceKeys: ["file-contents"],
      permissions: NO_PERMISSIONS,
      limit: 25,
      includeDeleted: false,
      fileContents: searcher,
    });

    expect(answer.groups[0]?.skipped).toBeNull();
    expect(answer.groups[0]?.hits.map((hit) => hit.id)).toEqual(["file_survey"]);
  });

  it("answers in the Files section, after the names of files and folders", () => {
    const keys = matterSearchSources.all().map((source) => source.key);
    expect(keys.indexOf("file-contents")).toBe(keys.indexOf("files") + 1);
    // The other matter's decoy file exists so the refusal above is a refusal and not an absence.
    expect(OTHER_MATTER).not.toBe(MATTER);
  });
});

describe("what an answer from the index becomes", () => {
  const passage = (fileId: string, chunkId: string): FileContentsPassage => ({ fileId, chunkId });

  it("asks for several passages a file and never more than the ceiling", () => {
    expect(passagesToAskFor(1)).toBe(8);
    expect(passagesToAskFor(26)).toBe(208);
    expect(passagesToAskFor(1000)).toBe(400);
  });

  it("keeps the distinct files in the index's order and stops at the number wanted", () => {
    const candidates = candidatesFrom(
      [
        passage("file_b", "page-9"),
        passage("file_a", "page-0"),
        passage("file_b", "page-1"),
        passage("file_c", "page-3"),
        // A page of a file already taken still counts for it after the limit is reached.
        passage("file_a", "page-4"),
      ],
      2,
    );
    expect(candidates).toEqual([
      { fileId: "file_b", pages: [10, 2] },
      { fileId: "file_a", pages: [1, 5] },
    ]);
  });

  it("keeps a file whose passage has no page a reader could turn to, without a page", () => {
    expect(candidatesFrom([passage("file_a", "whole"), passage("file_a", "page-x")], 5)).toEqual([
      { fileId: "file_a", pages: [] },
    ]);
  });

  it("names the best pages in reading order and counts the rest", () => {
    expect(pageNote([])).toBeNull();
    expect(pageNote([4])).toBe("Page 4");
    expect(pageNote([7, 3])).toBe("Pages 3 and 7");
    expect(pageNote([12, 3, 7])).toBe("Pages 3, 7 and 12");
    expect(pageNote([12, 3, 7, 1, 40])).toBe("Pages 3, 7, 12 and 2 more");
  });

  it("puts the page note before what the row already said about itself", () => {
    const row = (row_id: string, secondary: string | null): MatterSearchRawRow => ({
      row_id,
      matter_id: MATTER,
      sort_key: "2026-08-01T00:00:00.000Z",
      title: row_id,
      snippet: null,
      secondary,
      actor_user_id: null,
    });
    const arranged = arrangeByCandidates(
      [row("file_a", "Contracts"), row("file_b", null), row("file_c", "Deleted")],
      [
        { fileId: "file_c", pages: [] },
        { fileId: "file_missing", pages: [1] },
        { fileId: "file_a", pages: [2] },
        { fileId: "file_b", pages: [] },
      ],
    );
    expect(arranged.map((entry) => [entry.row_id, entry.secondary])).toEqual([
      ["file_c", "Deleted"],
      ["file_a", "Page 2 · Contracts"],
      ["file_b", null],
    ]);
  });
});

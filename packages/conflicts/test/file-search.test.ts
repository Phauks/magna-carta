import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, test } from "vitest";
import type { PartyNeedles } from "../src/content-search.ts";
import {
  FILE_QUERY_CEILING,
  phraseOf,
  searchFiles,
  type FileContentsAnswer,
  type FileContentsSearcher,
} from "../src/file-search.ts";

// Files as a place a check looks, over a real migrated per-firm database and a stand-in for the file
// contents index: the index is the search service's, so what is under test here is which matters are
// asked, what is asked of them, and which of the files the index names are kept.

const NOW = "2026-11-10T00:00:00.000Z";
const ACTOR = "user_actor" as UserId;

function corpus() {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Actor', 'active', '${NOW}')`,
  );
  const matter = (id: string, status: string, updatedAt: string) =>
    raw.exec(
      `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at)
       VALUES ('${id}', 'Matter ${id}', '${status}', '${ACTOR}', '${NOW}', '${updatedAt}')`,
    );
  matter("matter_open", "open", "2026-11-09T00:00:00.000Z");
  matter("matter_consult", "consultation", "2026-11-08T00:00:00.000Z");
  matter("matter_closed", "closed", "2026-11-07T00:00:00.000Z");
  const file = (id: string, matterId: string, deletedAt: string | null = null) =>
    raw.exec(
      `INSERT INTO file (id, matter_id, name, deleted_at, created_at, updated_at)
       VALUES ('${id}', '${matterId}', '${id}.pdf', ${deletedAt === null ? "NULL" : `'${deletedAt}'`}, '${NOW}', '${NOW}')`,
    );
  file("file_open", "matter_open");
  file("file_consult", "matter_consult");
  file("file_closed", "matter_closed");
  file("file_deleted", "matter_open", NOW);
  return { database };
}

const ACME: PartyNeedles = {
  entityId: "directoryOrganization_acme",
  names: ["Acme Holdings LLC"],
  emails: [],
  phoneDigits: [],
};

// An index that names, for each matter, the files whose text holds the phrase.
function fakeIndex(filesByMatter: Record<string, string[]>) {
  const asked: { matterId: string; phrases: readonly string[] }[] = [];
  const searcher: FileContentsSearcher = {
    query: ({ matterId, phrases }) => {
      asked.push({ matterId, phrases });
      return Promise.resolve({ ok: true, fileIds: filesByMatter[matterId] ?? [] });
    },
  };
  return { searcher, asked };
}

describe("searchFiles", () => {
  test("asks each matter in reach for the party's names as exact phrases", async () => {
    const { database } = corpus();
    const { searcher, asked } = fakeIndex({ matter_open: ["file_open"] });
    const outcome = await searchFiles(database, [ACME], ["open"], searcher);
    expect(asked).toEqual([{ matterId: "matter_open", phrases: ['"Acme Holdings LLC"'] }]);
    expect(outcome.status).toBe("searched");
    expect(outcome.hits).toEqual([
      {
        entityId: ACME.entityId,
        tier: 2,
        matchedFields: ['"Acme Holdings LLC" is named in the file\'s text'],
        foundIn: { kind: "file", id: "file_open", matterId: "matter_open", at: NOW },
      },
    ]);
    expect(outcome.mattersInReach).toBe(1);
    expect(outcome.mattersSearched).toBe(1);
  });

  test("keeps a deleted file only when Archived is asked for", async () => {
    const { database } = corpus();
    const index = { matter_open: ["file_open", "file_deleted"] };
    const withoutArchived = await searchFiles(database, [ACME], ["open"], fakeIndex(index).searcher);
    expect(withoutArchived.hits.map((hit) => hit.foundIn.id)).toEqual(["file_open"]);
    const withArchived = await searchFiles(
      database,
      [ACME],
      ["open", "archived"],
      fakeIndex(index).searcher,
    );
    expect(withArchived.hits.map((hit) => hit.foundIn.id).toSorted()).toEqual([
      "file_deleted",
      "file_open",
    ]);
  });

  test("Archived alone reaches every matter but keeps only deleted files", async () => {
    const { database } = corpus();
    const { searcher, asked } = fakeIndex({ matter_open: ["file_open", "file_deleted"] });
    const outcome = await searchFiles(database, [ACME], ["archived"], searcher);
    expect(asked.map((question) => question.matterId)).toEqual([
      "matter_open",
      "matter_consult",
      "matter_closed",
    ]);
    expect(outcome.hits.map((hit) => hit.foundIn.id)).toEqual(["file_deleted"]);
  });

  test("never reports a file the database files on another matter", async () => {
    const { database } = corpus();
    const { searcher } = fakeIndex({ matter_open: ["file_closed"] });
    const outcome = await searchFiles(database, [ACME], ["open", "closed"], searcher);
    expect(outcome.hits).toEqual([]);
  });

  test("records Files unavailable when the index cannot be reached, and stops asking", async () => {
    const { database } = corpus();
    const asked: string[] = [];
    const searcher: FileContentsSearcher = {
      query: ({ matterId }) => {
        asked.push(matterId);
        return Promise.resolve<FileContentsAnswer>({ ok: false, reason: "unavailable" });
      },
    };
    const outcome = await searchFiles(database, [ACME], ["consultations", "open", "closed"], searcher);
    expect(outcome.status).toBe("unavailable");
    expect(asked).toHaveLength(1);
    expect(await searchFiles(database, [ACME], ["open"], null)).toMatchObject({
      status: "unavailable",
    });
  });

  test("counts a matter whose query failed, and keeps the others' results", async () => {
    const { database } = corpus();
    const searcher: FileContentsSearcher = {
      query: ({ matterId }) =>
        Promise.resolve<FileContentsAnswer>(
          matterId === "matter_closed"
            ? { ok: false, reason: "failed" }
            : { ok: true, fileIds: matterId === "matter_open" ? ["file_open"] : [] },
        ),
    };
    const outcome = await searchFiles(database, [ACME], ["consultations", "open", "closed"], searcher);
    expect(outcome.mattersFailed).toBe(1);
    expect(outcome.mattersSearched).toBe(2);
    expect(outcome.hits.map((hit) => hit.foundIn.id)).toEqual(["file_open"]);
  });

  test("asks only the matters a summary says could match", async () => {
    const { database } = corpus();
    const { searcher, asked } = fakeIndex({ matter_closed: ["file_closed"] });
    const tokens: string[][] = [];
    const narrowing: FileContentsSearcher = {
      ...searcher,
      narrowMatters: (nameTokens) => {
        tokens.push([...nameTokens]);
        return Promise.resolve(["matter_closed"]);
      },
    };
    const outcome = await searchFiles(
      database,
      [ACME],
      ["consultations", "open", "closed"],
      narrowing,
    );
    expect(tokens).toEqual([["acme", "holdings", "llc"]]);
    expect(asked.map((question) => question.matterId)).toEqual(["matter_closed"]);
    expect(outcome.hits.map((hit) => hit.foundIn.id)).toEqual(["file_closed"]);
    expect(outcome.mattersInReach).toBe(3);
  });

  test("stops at the query ceiling and counts the matters left unsearched", async () => {
    const { database } = corpus();
    const parties: PartyNeedles[] = Array.from({ length: FILE_QUERY_CEILING / 2 }, (_, index) => ({
      entityId: `directoryPerson_${String(index)}`,
      names: [`Person Number${String(index)}`],
      emails: [],
      phoneDigits: [],
    }));
    const { searcher, asked } = fakeIndex({});
    const outcome = await searchFiles(database, parties, ["consultations", "open", "closed"], searcher);
    expect(new Set(asked.map((question) => question.matterId))).toEqual(
      new Set(["matter_open", "matter_consult"]),
    );
    expect(outcome.mattersNotSearched).toBe(1);
  });
});

describe("phraseOf", () => {
  test("quotes a name as one phrase and drops what would end it", () => {
    expect(phraseOf("  Acme   Holdings ")).toBe('"Acme Holdings"');
    expect(phraseOf('O"Brien \\ Co')).toBe('"O Brien Co"');
    expect(phraseOf('""')).toBeNull();
  });
});

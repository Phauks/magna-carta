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
    expect(answer.groups.map((entry) => entry.source)).toEqual([
      "files",
      "parties",
      "notes",
      "custody",
    ]);
  });

  it("finds the record across four different subsystems from one query", async () => {
    const answer = await search("easement");
    expect(titles(answer.groups, "files")).toEqual(["Easement survey.pdf"]);
    expect(titles(answer.groups, "custody")).toEqual(["Original easement deed"]);
    expect(group(answer.groups, "notes").hits).toHaveLength(1);
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

describe("a note's search follows the notes package's own rules", () => {
  it("never matches a retracted note, whose words stopped rendering everywhere", async () => {
    const answer = await search("misdescribed");
    expect(group(answer.groups, "notes").hits).toEqual([]);
  });

  it("never matches a superseded body, so a correction changes what is findable", async () => {
    // The original said "Easement-Wrongname"; the correction took the name out. Searching the name
    // must now find nothing — otherwise the correction fixed what the note SAYS and not what it
    // DISCLOSES, which is most of why somebody corrects one.
    const answer = await search("wrongname");
    expect(group(answer.groups, "notes").hits).toEqual([]);

    const stillFindable = await search("neighbour");
    expect(group(stillFindable.groups, "notes").hits).toHaveLength(1);
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
    expect(answer.groups).toHaveLength(4);
  });

  it("treats an empty scope the same way, rather than as nothing", async () => {
    const answer = await search("easement", { sourceKeys: [] });
    expect(answer.groups).toHaveLength(4);
  });
});

describe("a source the reader cannot read says so", () => {
  it("skips it for want of the capability rather than returning it empty", async () => {
    const answer = await search("easement", { permissions: NO_PERMISSIONS });
    expect(group(answer.groups, "notes").skipped).toBe("permission");
    expect(group(answer.groups, "custody").skipped).toBe("permission");
    // "Nothing matched" and "you cannot see this" must never look alike: the ungated sources still
    // answer, and they answer with hits.
    expect(group(answer.groups, "files").skipped).toBeNull();
    expect(group(answer.groups, "files").hits).toHaveLength(1);
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
    expect(titles(answer.groups, "files")).toEqual(["Easement survey.pdf"]);
  });

  it("includes it when asked, so it can be restored rather than hunted for", async () => {
    const answer = await search("easement", { includeDeleted: true });
    expect(titles(answer.groups, "files")).toContain("Easement draft (superseded).pdf");
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

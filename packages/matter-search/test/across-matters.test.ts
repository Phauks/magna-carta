import { describe, expect, it } from "vitest";
import {
  VISIBLE_MATTER_MARKER,
  visibleMatterPredicateExcluding,
  type VisibleMatterPredicate,
} from "@magna-carta/calendar/visibility";
import type { Permission } from "@magna-carta/access-control/registry";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { runSearchAcrossMatters } from "../src/run-across-matters.ts";
import { matterSearchSources } from "../src/sources/all.ts";
import type { AcrossMattersGroup, AcrossMattersSearchAnswer } from "../src/types.ts";
import {
  ACTOR,
  ALL_PERMISSIONS,
  HOLDING_MATTER,
  MATTER,
  NO_PERMISSIONS,
  OTHER_MATTER,
  seededDatabase,
  seedNote,
  visibility,
} from "./support.ts";

// The search across matters: one question answered from every matter the reader may see.
//
// Nearly everything worth pinning here is about what does NOT come back, as it is for a matter's own
// search, with the difference that the second matter's records are now meant to answer:
//
//   - the reach is the visible-matter predicate, so a matter it excludes answers nothing and takes
//     no place in the limit, and the platform's own holding matter never answers;
//   - only a source that declared it answers across matters, and every other says it was not asked;
//   - a capability the reader lacks withholds its source before a statement is built;
//   - a question matched by more of the index than the cap is answered from the newest matches and
//     says so, and one matched by fewer is answered in full and does not.

const INSTANT = "2026-08-01T00:00:00.000Z";
type Raw = ReturnType<typeof seededDatabase>["raw"];

function seedTimeEntry(raw: Raw, id: string, matterId: string, narrative: string): void {
  raw.exec(
    `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, ` +
      `raw_duration_minutes, narrative, billable, currency, status, source, created_at, updated_at) ` +
      `VALUES ('${id}', '${matterId}', '${ACTOR}', '2026-07-01', 30, 30, '${narrative}', 1, 'USD', ` +
      `'draft', 'manual', '${INSTANT}', '${INSTANT}')`,
  );
}

function seedCall(
  raw: Raw,
  id: string,
  matterId: string | null,
  options: { summary: string; number: string },
): void {
  raw.exec(
    `INSERT INTO communication (id, matter_id, channel, direction, counterparty_number, ` +
      `occurred_at, producer, logged_by_user_id, summary, created_at, updated_at) ` +
      `VALUES ('${id}', ${matterId === null ? "NULL" : `'${matterId}'`}, 'voice', 'inbound', ` +
      `'${options.number}', '${INSTANT}', 'member', '${ACTOR}', '${options.summary}', ` +
      `'${INSTANT}', '${INSTANT}')`,
  );
}

interface AskOptions {
  readonly sourceKeys?: readonly string[];
  readonly permissions?: ReadonlySet<Permission>;
  readonly limit?: number;
  readonly candidateCap?: number;
  readonly visibility?: VisibleMatterPredicate;
}

function ask(
  database: SqlDatabase,
  query: string,
  options: AskOptions = {},
): Promise<AcrossMattersSearchAnswer> {
  return runSearchAcrossMatters({
    database,
    registry: matterSearchSources,
    query,
    visibility: options.visibility ?? visibility,
    sourceKeys: options.sourceKeys,
    permissions: options.permissions ?? ALL_PERMISSIONS,
    limit: options.limit ?? 25,
    ...(options.candidateCap === undefined ? {} : { candidateCap: options.candidateCap }),
  });
}

function groupOf(answer: AcrossMattersSearchAnswer, key: string): AcrossMattersGroup {
  const found = answer.groups.find((group) => group.source === key);
  if (found === undefined) throw new Error(`no group for ${key}`);
  return found;
}

function hitIds(answer: AcrossMattersSearchAnswer, key: string): string[] {
  return groupOf(answer, key)
    .hits.map((hit) => hit.id)
    .toSorted();
}

describe("a search across matters reaches every matter the reader may see", () => {
  it("answers with records from more than one matter, each naming its matter", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement");
    const notes = groupOf(answer, "notes");
    expect(notes.skipped).toBeNull();
    expect(notes.hits.map((hit) => [hit.id, hit.matterId]).toSorted()).toEqual([
      ["matterNote_decoy", OTHER_MATTER],
      ["matterNote_easement", MATTER],
      ["matterNote_occurred", MATTER],
    ]);
    // A hit links into its own matter's section, the screen that shows the record.
    const other = notes.hits.find((hit) => hit.id === "matterNote_decoy");
    expect(other?.link).toBe(`/matters/${OTHER_MATTER}/notes?entry=matterNote_decoy`);
  });

  it("finds files and folders by name on every matter, and never a deleted file", async () => {
    const { database } = seededDatabase();
    expect(hitIds(await ask(database, "easement"), "files")).toEqual([
      "file_decoy",
      "file_survey",
      "folder_decoy",
      "folder_exhibits",
    ]);
  });

  it("never answers from the platform's own holding matter", async () => {
    const { database, raw } = seededDatabase();
    seedNote(raw, { id: "matterNote_holding", matterId: HOLDING_MATTER, body: "Easement held." });
    const answer = await ask(database, "easement");
    expect(hitIds(answer, "files")).not.toContain("file_holding");
    expect(hitIds(answer, "notes")).not.toContain("matterNote_holding");
  });

  it("leaves out a matter the predicate excludes, before the limit and not after it", async () => {
    const { database } = seededDatabase();
    const walled = visibleMatterPredicateExcluding([MATTER]);
    // Two of the three notes are on the excluded matter. A limit of one must still find the one
    // the reader may see, and must not report more: a filter applied after the limit would return
    // nothing here, or say there was more when the rest were never theirs to see.
    const answer = await ask(database, "easement", { visibility: walled, limit: 1 });
    const notes = groupOf(answer, "notes");
    expect(notes.hits.map((hit) => hit.id)).toEqual(["matterNote_decoy"]);
    expect(notes.hasMore).toBe(false);
    expect(hitIds(answer, "files")).toEqual(["file_decoy"]);
  });

  it("does not find a call or text that is on no matter", async () => {
    const { database, raw } = seededDatabase();
    seedCall(raw, "communication_routed", MATTER, {
      summary: "Asked about the boundary covenant",
      number: "+17025550142",
    });
    seedCall(raw, "communication_unrouted", null, {
      summary: "Somebody asking about a covenant",
      number: "+17025550199",
    });
    expect(hitIds(await ask(database, "covenant"), "communications")).toEqual([
      "communication_routed",
    ]);
  });

  it("matches a call by its words across matters and not by its number", async () => {
    const { database, raw } = seededDatabase();
    seedCall(raw, "communication_routed", MATTER, {
      summary: "Asked about the boundary covenant",
      number: "+17025550142",
    });
    const answer = await ask(database, "0142");
    const calls = groupOf(answer, "communications");
    expect(calls.hits).toEqual([]);
    // And the group says what it matched on here, which is less than inside a matter.
    expect(calls.matchedFields).toEqual(["what was said", "the caller's name"]);
  });
});

describe("what a search across matters does not ask", () => {
  it("reports a source that answers inside one matter only, and never runs it", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement");
    const oneMatterOnly = answer.groups
      .filter((group) => group.skipped === "one-matter-only")
      .map((group) => group.source)
      .toSorted();
    expect(oneMatterOnly).toEqual(["billing", "calendar", "custody", "file-contents", "parties"]);
    // The custody packet and the party both carry the word and neither answers.
    expect(groupOf(answer, "custody").hits).toEqual([]);
    expect(groupOf(answer, "parties").hits).toEqual([]);
  });

  it("answers in the registry's order, with a group for every source", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement");
    expect(answer.groups.map((group) => group.source)).toEqual(
      matterSearchSources.all().map((source) => source.key),
    );
  });

  it("withholds a source the reader lacks the capability for, and says so", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement", { permissions: NO_PERMISSIONS });
    expect(groupOf(answer, "notes")).toMatchObject({ hits: [], skipped: "permission" });
    // Any member of the firm may read a matter's file list, so that source still answers.
    expect(groupOf(answer, "files").skipped).toBeNull();
    expect(hitIds(answer, "files")).toContain("file_survey");
  });

  it("says a question is too short instead of answering it with nothing", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "e");
    expect(groupOf(answer, "notes").skipped).toBe("query-too-short");
    expect(answer.broad).toBe(false);
  });

  it("narrows to the places asked for", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement", { sourceKeys: ["notes"] });
    expect(answer.groups.map((group) => group.source)).toEqual(["notes"]);
  });
});

describe("a question matched by more records than one search reads", () => {
  it("is answered in full, and not called broad, when the matches fit under the cap", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement", { candidateCap: 3 });
    expect(answer.broad).toBe(false);
    expect(hitIds(answer, "notes")).toHaveLength(3);
  });

  it("is answered from the newest matches, and says so, when they do not", async () => {
    const { database, raw } = seededDatabase();
    // Written last, so it is the newest entry in the index.
    seedNote(raw, { id: "matterNote_latest", matterId: OTHER_MATTER, body: "Easement, again." });
    const answer = await ask(database, "easement", { candidateCap: 1 });
    expect(answer.broad).toBe(true);
    expect(hitIds(answer, "notes")).toEqual(["matterNote_latest"]);
  });

  it("counts every source's matches against the one cap", async () => {
    const { database, raw } = seededDatabase();
    seedTimeEntry(raw, "timeEntry_easement", MATTER, "Researched the easement");
    // Three notes and one time entry hold the word: four matches against a cap of three.
    const answer = await ask(database, "easement", { candidateCap: 3 });
    expect(answer.broad).toBe(true);
    // The time entry is the newest match, so it is among the three the cap admits.
    expect(hitIds(answer, "time")).toEqual(["timeEntry_easement"]);
    expect(hitIds(answer, "notes")).toHaveLength(2);
  });

  it("is not called broad for names alone, which read no index", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement", { sourceKeys: ["files"], candidateCap: 1 });
    expect(answer.broad).toBe(false);
  });
});

describe("a reader's text across matters", () => {
  it("is never the index's syntax", async () => {
    const { database } = seededDatabase();
    // An operator, a column filter and an unpaired quotation mark are all just text.
    for (const text of ['easement OR fence"', "body:easement", "easement NOT fence", "(easement"]) {
      const answer = await ask(database, text, { sourceKeys: ["notes"] });
      expect(groupOf(answer, "notes").skipped).toBeNull();
    }
    // Every word must be in the record: "OR" is a word here, and no note holds it.
    expect(hitIds(await ask(database, "easement OR fence"), "notes")).toEqual([]);
  });

  it("matches a name's characters literally, wildcards included", async () => {
    const { database } = seededDatabase();
    expect(hitIds(await ask(database, "%"), "files")).toEqual([]);
    expect(hitIds(await ask(database, "__"), "files")).toEqual([]);
  });

  it("reads one past the limit to say there is more, and returns the limit", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement", { limit: 2 });
    const notes = groupOf(answer, "notes");
    expect(notes.hits).toHaveLength(2);
    expect(notes.hasMore).toBe(true);
    // Files and folders are two statements merged before the limit, not the first two of one.
    const files = groupOf(answer, "files");
    expect(files.hits).toHaveLength(2);
    expect(files.hasMore).toBe(true);
  });
});

// The properties every source declaring `acrossMatters` must have, read off the SQL it builds.
describe("every statement a source builds for a search across matters", () => {
  function statements(): { key: string; reads: string; sql: string }[] {
    const { database } = seededDatabase();
    const captured: { key: string; reads: string; sql: string }[] = [];
    for (const source of matterSearchSources.all()) {
      const declaration = source.acrossMatters;
      if (declaration === undefined) continue;
      const recorder = {
        prepare: (sql: string): SqlStatement => {
          captured.push({ key: source.key, reads: declaration.reads, sql });
          return database.prepare(sql);
        },
      };
      declaration.buildStatements({
        database: recorder,
        query: "easement",
        visibility,
        limit: 10,
        candidateCap: 100,
      });
    }
    return captured;
  }

  const EVERY_STATEMENT = statements();

  it("is built by the sources this test expects, so a new one is read by somebody", () => {
    expect([...new Set(EVERY_STATEMENT.map((statement) => statement.key))].toSorted()).toEqual([
      "communications",
      "costs",
      "files",
      "notes",
      "time",
    ]);
  });

  it.each(EVERY_STATEMENT)("$key binds no matter", ({ sql }) => {
    expect(sql).not.toMatch(/\.matter_id = \?/u);
  });

  it.each(EVERY_STATEMENT)(
    "$key composes the visible-matter predicate before its limit",
    ({ sql }) => {
      expect(sql).toContain(VISIBLE_MATTER_MARKER);
      expect(sql.indexOf(VISIBLE_MATTER_MARKER)).toBeLessThan(sql.lastIndexOf("LIMIT"));
    },
  );

  it.each(EVERY_STATEMENT)("$key is bounded and totally ordered", ({ sql }) => {
    expect(sql).toMatch(/LIMIT \?$/u);
    expect(sql).toMatch(/ORDER BY .+, \S+ (ASC|DESC) LIMIT \?$/u);
  });

  it.each(EVERY_STATEMENT)("$key reads what it declared it reads", ({ reads, sql }) => {
    const likes = sql.match(/LIKE \?/gu) ?? [];
    if (reads === "record-index") {
      // The newest matches, capped inside the index, and no scan of a column beside them.
      expect(sql).toContain("LIMIT ?) AS newest_match");
      expect(likes).toHaveLength(0);
    } else {
      expect(sql).not.toContain("record_text_fts");
      expect(likes.length).toBeGreaterThan(0);
      expect(sql.match(/LIKE \? ESCAPE '\\'/gu) ?? []).toHaveLength(likes.length);
    }
  });

  it.each(EVERY_STATEMENT)("$key names no discovery review table", ({ sql }) => {
    expect(sql).not.toMatch(/\breview_(set|document|load|tag|coding)\b/u);
    expect(sql).not.toMatch(/\bdiscovery_/u);
  });
});

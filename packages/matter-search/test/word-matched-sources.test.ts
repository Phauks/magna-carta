import { describe, expect, it } from "vitest";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { recordIndexSources } from "@magna-carta/search/record-index-sources";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runMatterSearch } from "../src/run.ts";
import { matterSearchSources } from "../src/sources/all.ts";
import {
  ACTOR,
  ALL_PERMISSIONS,
  MATTER,
  OTHER_MATTER,
  seededDatabase,
  seedNote,
  visibility,
} from "./support.ts";

// The sources whose text is prose, and which therefore match WORDS through the firm's record index
// rather than characters by reading every row. These pin what a reader gets from that — and what
// they no longer get — through the whole search, with records written to their own tables by plain
// statements, the way every domain package writes them.

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

function seedCostEntry(raw: Raw, id: string, matterId: string, description: string): void {
  raw.exec(
    `INSERT INTO cost_entry (id, matter_id, incurred_date, amount_minor, currency, ` +
      `disbursement_class, billable, status, source, description, created_at, updated_at) ` +
      `VALUES ('${id}', '${matterId}', '2026-07-02', 1500, 'USD', 'hard', 1, 'draft', 'manual', ` +
      `'${description}', '${INSTANT}', '${INSTANT}')`,
  );
}

function seedEvent(
  raw: Raw,
  id: string,
  matterId: string,
  title: string,
  description: string,
): void {
  raw.exec(
    `INSERT INTO matter_event (id, matter_id, title, description, starts_on, time_zone, ` +
      `recorded_at, created_at, updated_at) VALUES ('${id}', '${matterId}', '${title}', ` +
      `'${description}', '2026-07-03', 'America/Chicago', '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
  );
}

function seedCall(
  raw: Raw,
  id: string,
  matterId: string,
  options: { summary: string; number: string; callerIdName?: string },
): void {
  raw.exec(
    `INSERT INTO communication (id, matter_id, channel, direction, counterparty_number, ` +
      `occurred_at, producer, logged_by_user_id, summary, caller_id_name, created_at, updated_at) ` +
      `VALUES ('${id}', '${matterId}', 'voice', 'inbound', '${options.number}', '${INSTANT}', ` +
      `'member', '${ACTOR}', '${options.summary}', ` +
      `${options.callerIdName === undefined ? "NULL" : `'${options.callerIdName}'`}, ` +
      `'${INSTANT}', '${INSTANT}')`,
  );
}

async function ids(
  database: SqlDatabase,
  sourceKey: string,
  query: string,
  matterId = MATTER,
): Promise<string[]> {
  const answer = await runMatterSearch({
    database,
    registry: matterSearchSources,
    matterId,
    query,
    visibility,
    sourceKeys: [sourceKey],
    permissions: ALL_PERMISSIONS,
    limit: 25,
    includeDeleted: false,
  });
  return (answer.groups[0]?.hits ?? []).map((hit) => hit.id).toSorted();
}

describe("a prose source matches words", () => {
  it("finds a note by a word, by the start of the last word, and in any case", async () => {
    const { database } = seededDatabase();
    const both = ["matterNote_easement", "matterNote_occurred"];
    expect(await ids(database, "notes", "easement")).toEqual(both);
    expect(await ids(database, "notes", "ease")).toEqual(both);
    expect(await ids(database, "notes", "EASEMENT")).toEqual(both);
  });

  it("finds a note by several words wherever they fall in it", async () => {
    const { database } = seededDatabase();
    // The words are not adjacent in the note, and not in this order.
    expect(await ids(database, "notes", "fence neighbour")).toEqual(["matterNote_occurred"]);
    // Every word must be there.
    expect(await ids(database, "notes", "fence covenant")).toEqual([]);
  });

  it("matches a quoted phrase as that exact run of words", async () => {
    const { database } = seededDatabase();
    expect(await ids(database, "notes", '"easement fence"')).toEqual(["matterNote_occurred"]);
    expect(await ids(database, "notes", '"fence easement"')).toEqual([]);
  });

  it("does not match the middle of a word", async () => {
    const { database } = seededDatabase();
    expect(await ids(database, "notes", "sement")).toEqual([]);
  });

  it("ignores accents either way", async () => {
    const { database, raw } = seededDatabase();
    seedNote(raw, { id: "matterNote_accent", matterId: MATTER, body: "Sent the résumé to Peña." });
    expect(await ids(database, "notes", "resume pena")).toEqual(["matterNote_accent"]);
    expect(await ids(database, "notes", "Peña")).toEqual(["matterNote_accent"]);
  });

  it("answers text that looks like query syntax as words, without failing", async () => {
    const { database } = seededDatabase();
    for (const query of ['easement"', "easement AND", "(easement", "title:easement", "ea*", '""']) {
      await ids(database, "notes", query);
    }
    expect(await ids(database, "notes", 'runs" OR "x')).toEqual([]);
    expect(await ids(database, "notes", "easement NOT fence")).toEqual([]);
  });

  it("builds no statement for text with nothing to match in it", async () => {
    const { database } = seededDatabase();
    expect(await ids(database, "notes", "%%")).toEqual([]);
    expect(await ids(database, "notes", "--")).toEqual([]);
  });
});

describe("every prose source reads the index and stays inside its matter", () => {
  it("finds time, costs and calendar records by their words, on the searched matter only", async () => {
    const { database, raw } = seededDatabase();
    seedTimeEntry(raw, "timeEntry_here", MATTER, "Reviewed the quitclaim deed");
    seedTimeEntry(raw, "timeEntry_there", OTHER_MATTER, "Drafted a quitclaim deed");
    seedCostEntry(raw, "costEntry_here", MATTER, "Quitclaim recording fee");
    seedCostEntry(raw, "costEntry_there", OTHER_MATTER, "Quitclaim courier");
    seedEvent(raw, "matterEvent_here", MATTER, "Hearing", "on the quitclaim motion");
    seedEvent(raw, "matterEvent_there", OTHER_MATTER, "Quitclaim signing", "at the office");

    expect(await ids(database, "time", "quitclaim")).toEqual(["timeEntry_here"]);
    expect(await ids(database, "costs", "quitclaim")).toEqual(["costEntry_here"]);
    // One word from the title and one from the description.
    expect(await ids(database, "calendar", "hearing quitclaim")).toEqual(["matterEvent_here"]);
    expect(await ids(database, "time", "quitclaim", OTHER_MATTER)).toEqual(["timeEntry_there"]);
  });

  it("follows an edit and a deletion without anything telling the index", async () => {
    const { database, raw } = seededDatabase();
    seedTimeEntry(raw, "timeEntry_here", MATTER, "Reviewed the quitclaim deed");
    raw.exec(
      `UPDATE time_entry SET narrative = 'Reviewed the warranty deed' WHERE id = 'timeEntry_here'`,
    );

    expect(await ids(database, "time", "quitclaim")).toEqual([]);
    expect(await ids(database, "time", "warranty")).toEqual(["timeEntry_here"]);

    raw.exec(`DELETE FROM matter_note WHERE id = 'matterNote_easement'`);
    expect(await ids(database, "notes", "easement")).toEqual(["matterNote_occurred"]);
  });

  // The index proposes; the source's own statement decides. An index row that named the wrong matter
  // — which nothing should ever write — still could not carry a record across, because the statement
  // binds the matter on the record's own table.
  it("refuses a record the index wrongly proposes for another matter", async () => {
    const { database, raw } = seededDatabase();
    const scope = (matterId: string): string =>
      `m${[...new TextEncoder().encode(matterId)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    // Corrupt the index on purpose: file the other matter's note under the searched matter.
    const entry = raw
      .prepare(
        `SELECT id FROM record_text_entry WHERE source = 'notes' AND record_id = 'matterNote_decoy'`,
      )
      .get() as { id: number };
    raw.exec(`DELETE FROM record_text_fts WHERE rowid = ${String(entry.id)}`);
    raw.exec(
      `INSERT INTO record_text_fts (rowid, scope, title, body) ` +
        `VALUES (${String(entry.id)}, '${scope(MATTER)}', NULL, 'An easement elsewhere.')`,
    );

    expect(await ids(database, "notes", "elsewhere")).toEqual([]);
  });

  it("excludes the platform-owned holding matter exactly as before", async () => {
    const { database, raw } = seededDatabase();
    const holding = "matter_searchHolding00000000000000";
    seedNote(raw, { id: "matterNote_holding", matterId: holding, body: "easement original" });
    const answer = await runMatterSearch({
      database,
      registry: matterSearchSources,
      matterId: holding as typeof MATTER,
      query: "easement",
      visibility: visibleMatterPredicate(),
      sourceKeys: ["notes"],
      permissions: ALL_PERMISSIONS,
      limit: 10,
      includeDeleted: false,
    });
    expect(answer.groups[0]?.hits).toEqual([]);
  });
});

describe("calls and texts match words, and the number as characters", () => {
  it("finds a call by what was written about it and by the caller's name", async () => {
    const { database, raw } = seededDatabase();
    seedCall(raw, "communication_here", MATTER, {
      summary: "Left a voicemail about the survey",
      number: "+15555550142",
      callerIdName: "HERRERA MARIA",
    });
    seedCall(raw, "communication_there", OTHER_MATTER, {
      summary: "Voicemail about the survey",
      number: "+15555550199",
    });

    expect(await ids(database, "communications", "voicemail survey")).toEqual([
      "communication_here",
    ]);
    expect(await ids(database, "communications", "herrera")).toEqual(["communication_here"]);
  });

  it("still finds a call by any part of its number", async () => {
    const { database, raw } = seededDatabase();
    seedCall(raw, "communication_here", MATTER, { summary: "Callback", number: "+15555550142" });
    seedCall(raw, "communication_there", OTHER_MATTER, {
      summary: "Callback",
      number: "+15555550142",
    });

    // The middle of the number: characters, not a word.
    expect(await ids(database, "communications", "5550")).toEqual(["communication_here"]);
    // Punctuation only around digits still leaves the number half to answer.
    expect(await ids(database, "communications", "0142")).toEqual(["communication_here"]);
  });
});

describe("the two registries agree about which sources read the index", () => {
  // A matter search source hands `recordIndexMatch` a key by literal. This holds that every
  // statement naming the index names a source the index declares, and that a source the index
  // declares under a key the matter search also uses is in fact read through it — so a source cannot
  // be declared searchable-by-index in one place and quietly keep scanning in the other.
  it("names only declared record index sources, and reads each shared one through the index", () => {
    const declared = new Set(recordIndexSources.map((source) => source.key));
    for (const source of matterSearchSources.all()) {
      const captured: string[] = [];
      const recorder: SqlDatabase = {
        prepare: (sql: string) => {
          captured.push(sql);
          const statement = { bind: () => statement };
          return statement as unknown as ReturnType<SqlDatabase["prepare"]>;
        },
      };
      source.buildStatements({
        database: recorder,
        matterId: MATTER,
        query: "easement",
        visibility,
        limit: 10,
        includeDeleted: false,
      });
      const named = captured.flatMap((sql) =>
        [...sql.matchAll(/record_text_entry\.source = '([^']+)'/gu)].map((match) => match[1]!),
      );
      for (const key of named) expect(declared.has(key), `${source.key} names ${key}`).toBe(true);
      if (declared.has(source.key)) {
        expect(named, `${source.key} is declared to the index and does not read it`).toEqual([
          source.key,
        ]);
      }
    }
  });
});

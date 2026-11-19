import { describe, expect, it } from "vitest";
import {
  VISIBLE_MATTER_MARKER,
  visibleMatterPredicateExcluding,
  type VisibleMatterPredicate,
} from "@magna-carta/calendar/visibility";
import type { Permission } from "@magna-carta/access-control/registry";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { RECORD_QUERY_MATTERS_LIMIT } from "@magna-carta/search/record-index-query";
import type { FileContentsAnswer, MatterFileContentsSearcher } from "../src/file-contents.ts";
import { narrowedVisibility, type MatterNarrowing } from "../src/narrowing.ts";
import { runSearchAcrossMatters } from "../src/run-across-matters.ts";
import { runMatterSearch } from "../src/run.ts";
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
  seedInvoiceLine,
  seedNote,
  seedPacket,
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
  readonly narrowing?: MatterNarrowing;
  readonly fileContents?: MatterFileContentsSearcher | null;
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
    ...(options.narrowing === undefined ? {} : { narrowing: options.narrowing }),
    ...(options.fileContents === undefined ? {} : { fileContents: options.fileContents }),
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

  it("finds a packet of originals by name or custody number on every matter", async () => {
    const { database } = seededDatabase();
    const byName = groupOf(await ask(database, "easement"), "custody");
    expect(byName.skipped).toBeNull();
    expect(byName.hits.map((hit) => [hit.id, hit.matterId]).toSorted()).toEqual([
      ["custodyPacket_decoy", OTHER_MATTER],
      ["custodyPacket_deed", MATTER],
    ]);
    expect(hitIds(await ask(database, "CUS-2026-0002"), "custody")).toEqual([
      "custodyPacket_decoy",
    ]);
  });

  it("finds a party on each matter they are on, naming what they are to it", async () => {
    const { database } = seededDatabase();
    const parties = groupOf(await ask(database, "east"), "parties");
    expect(parties.skipped).toBeNull();
    expect(
      parties.hits.map((hit) => [hit.id, hit.matterId, hit.title, hit.secondary]).toSorted(),
    ).toEqual([
      ["matterParty_decoy", OTHER_MATTER, "Ruth Eastwood", "client"],
      ["matterParty_neighbour", MATTER, "Marta Easton", "opposing_party · Trustee"],
    ]);
    // The capacity a party acts in is matched too, as it is inside a matter.
    expect(hitIds(await ask(database, "trustee"), "parties")).toEqual(["matterParty_neighbour"]);
  });

  it("finds an invoice line by what it says, on the line's own matter, and links to its invoice", async () => {
    const { database, raw } = seededDatabase();
    // One invoice billing two matters: each line answers under its own matter.
    seedInvoiceLine(raw, {
      id: "invoiceLine_survey",
      invoiceId: "invoice_shared",
      matterId: MATTER,
      description: "Review of the easement survey",
    });
    seedInvoiceLine(raw, {
      id: "invoiceLine_other",
      invoiceId: "invoice_shared",
      matterId: OTHER_MATTER,
      description: "Call about the easement",
    });
    seedInvoiceLine(raw, {
      id: "invoiceLine_holding",
      invoiceId: "invoice_shared",
      matterId: HOLDING_MATTER,
      description: "Easement storage",
    });
    const billing = groupOf(await ask(database, "easement"), "billing");
    expect(billing.skipped).toBeNull();
    expect(billing.hits.map((hit) => [hit.id, hit.matterId]).toSorted()).toEqual([
      ["invoiceLine_other", OTHER_MATTER],
      ["invoiceLine_survey", MATTER],
    ]);
    const line = billing.hits.find((hit) => hit.id === "invoiceLine_survey");
    expect(line?.link).toBe(`/matters/${MATTER}/billing?entry=invoice_shared`);
    expect(line?.secondary).toBe("Draft · draft");
  });

  it("describes an invoice line as the matter's own search does, numbered or not", async () => {
    const { database, raw } = seededDatabase();
    seedInvoiceLine(raw, {
      id: "invoiceLine_draft",
      invoiceId: "invoice_draft",
      matterId: MATTER,
      description: "Easement research",
    });
    seedInvoiceLine(raw, {
      id: "invoiceLine_final",
      invoiceId: "invoice_final",
      matterId: MATTER,
      description: "Easement hearing",
    });
    raw.exec(
      `UPDATE invoice SET status = 'final', invoice_number = 'INV-0042', number_scope_key = '', ` +
        `number_drawn_value = 42, issue_date = '2026-08-01', due_date = '2026-08-31', ` +
        `finalized_at = '${INSTANT}' WHERE id = 'invoice_final'`,
    );
    const across = groupOf(await ask(database, "easement"), "billing");
    const inside = await runMatterSearch({
      database,
      registry: matterSearchSources,
      matterId: MATTER,
      query: "easement",
      visibility,
      sourceKeys: ["billing"],
      permissions: ALL_PERMISSIONS,
      limit: 25,
      includeDeleted: false,
    });
    const describe = (hits: readonly { id: string; title: string; secondary: string | null }[]) =>
      hits.map((hit) => [hit.id, hit.title, hit.secondary]).toSorted();
    expect(describe(across.hits)).toEqual([
      ["invoiceLine_draft", "Easement research", "Draft · draft"],
      ["invoiceLine_final", "Easement hearing", "INV-0042 · final"],
    ]);
    expect(describe(across.hits)).toEqual(
      describe(inside.groups.find((group) => group.source === "billing")?.hits ?? []),
    );
    // An invoice's number finds its lines, as it does inside the matter.
    expect(hitIds(await ask(database, "INV-0042"), "billing")).toEqual(["invoiceLine_final"]);
  });

  it("answers once for a party matched by both their name and their capacity", async () => {
    const { database, raw } = seededDatabase();
    raw.exec(
      `INSERT INTO directory_person (id, display_name, deceased, status, needs_review, created_at, updated_at) ` +
        `VALUES ('directoryPerson_trust', 'Trustee Services Ltd', 0, 'active', 0, '${INSTANT}', '${INSTANT}')`,
    );
    raw.exec(
      `INSERT INTO matter_party (id, matter_id, entity_id, role, capacity, created_at, updated_at) ` +
        `VALUES ('matterParty_both', '${OTHER_MATTER}', 'directoryPerson_trust', 'witness', ` +
        `'Trustee', '${INSTANT}', '${INSTANT}')`,
    );
    expect(
      groupOf(await ask(database, "trustee"), "parties").hits.map((hit) => hit.id),
    ).toHaveLength(2);
    expect(hitIds(await ask(database, "trustee"), "parties")).toEqual([
      "matterParty_both",
      "matterParty_neighbour",
    ]);
  });

  it("does not find a party whose person is deleted or merged away", async () => {
    const { database, raw } = seededDatabase();
    raw.exec(
      `UPDATE directory_person SET deleted_at = '${INSTANT}' WHERE id = 'directoryPerson_eastwood'`,
    );
    raw.exec(
      `UPDATE directory_person SET status = 'merged_into' WHERE id = 'directoryPerson_easton'`,
    );
    expect(hitIds(await ask(database, "east"), "parties")).toEqual([]);
    // Nor by the capacity alone: a party with no name to show is not an answer.
    expect(hitIds(await ask(database, "trustee"), "parties")).toEqual([]);
  });

  it("withholds invoice lines and packets from a reader without their capabilities", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement", { permissions: NO_PERMISSIONS });
    expect(groupOf(answer, "billing")).toMatchObject({ skipped: "permission", hits: [] });
    expect(groupOf(answer, "custody")).toMatchObject({ skipped: "permission", hits: [] });
    // Who is on a matter is open to any member of the firm, as it is inside a matter.
    expect(groupOf(answer, "parties").skipped).toBeNull();
  });

  it("never answers from the platform's own holding matter", async () => {
    const { database, raw } = seededDatabase();
    seedNote(raw, { id: "matterNote_holding", matterId: HOLDING_MATTER, body: "Easement held." });
    const answer = await ask(database, "easement");
    expect(hitIds(answer, "files")).not.toContain("file_holding");
    expect(hitIds(answer, "notes")).not.toContain("matterNote_holding");
  });

  it("does not find a packet the register holds on its own holding matter", async () => {
    const { database, raw } = seededDatabase();
    seedPacket(raw, {
      id: "custodyPacket_holding",
      matterId: HOLDING_MATTER,
      name: "Easement originals awaiting a matter",
      custodyNumber: "CUS-2026-0003",
    });
    expect(hitIds(await ask(database, "easement"), "custody")).not.toContain(
      "custodyPacket_holding",
    );
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
    expect(oneMatterOnly).toEqual(["calendar"]);
    for (const key of oneMatterOnly) expect(groupOf(answer, key).hits).toEqual([]);
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

// The shape a caller hands in: a list the database works out, and the matter tested against it.
function mattersNamed(...matterIds: readonly string[]): MatterNarrowing {
  return {
    fragmentFor: (matterIdExpression) =>
      `${matterIdExpression} IN (${matterIds.map(() => "?").join(", ")})`,
    bindings: matterIds,
  };
}

function seedMatter(raw: Raw, id: string): void {
  raw.exec(
    `INSERT INTO matter (id, title, status, responsible_member_id, system_key, opened_at, ` +
      `created_at, updated_at) VALUES ('${id}', 'Narrowed', 'open', '${ACTOR}', NULL, ` +
      `'${INSTANT}', '${INSTANT}', '${INSTANT}')`,
  );
}

// A reader's own narrowing: fewer matters than they may see, and never more.
describe("a search across matters narrowed by its reader", () => {
  it("answers from the matters it names and no others, in every kind of source", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement", { narrowing: mattersNamed(OTHER_MATTER) });
    expect(hitIds(answer, "notes")).toEqual(["matterNote_decoy"]);
    expect(hitIds(answer, "files")).toEqual(["file_decoy", "folder_decoy"]);
    expect(hitIds(answer, "custody")).toEqual(["custodyPacket_decoy"]);
    for (const group of answer.groups) {
      for (const hit of group.hits) expect(hit.matterId).toBe(OTHER_MATTER);
    }
  });

  it("cannot reach a matter the reader may not see by naming it", async () => {
    const { database } = seededDatabase();
    // The platform's holding matter, and a matter the predicate excludes, both named outright.
    const answer = await ask(database, "easement", {
      narrowing: mattersNamed(HOLDING_MATTER, OTHER_MATTER, MATTER),
      visibility: visibleMatterPredicateExcluding([OTHER_MATTER]),
    });
    const matters = new Set(
      answer.groups.flatMap((group) => group.hits.map((hit) => hit.matterId)),
    );
    expect([...matters]).toEqual([MATTER]);
  });

  it("is answered in full where the same words across the firm are cut at the cap", async () => {
    const { database, raw } = seededDatabase();
    // Written last on the OTHER matter, so they are the newest entries in the index and take
    // every place under a cap of two.
    seedNote(raw, { id: "matterNote_newer", matterId: OTHER_MATTER, body: "Easement, again." });
    seedNote(raw, {
      id: "matterNote_newest",
      matterId: OTHER_MATTER,
      body: "Easement, once more.",
    });
    const firmWide = await ask(database, "easement", { candidateCap: 2 });
    expect(firmWide.broad).toBe(true);
    expect(hitIds(firmWide, "notes")).toEqual(["matterNote_newer", "matterNote_newest"]);
    // The one matter's own two notes are older than both, and are all there when it is named.
    const narrowed = await ask(database, "easement", {
      candidateCap: 2,
      narrowing: mattersNamed(MATTER),
    });
    expect(narrowed.broad).toBe(false);
    expect(hitIds(narrowed, "notes")).toEqual(["matterNote_easement", "matterNote_occurred"]);
  });

  it("says broad when the named matters themselves hold more than the cap", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement", {
      candidateCap: 1,
      narrowing: mattersNamed(MATTER),
    });
    expect(answer.broad).toBe(true);
    expect(hitIds(answer, "notes")).toHaveLength(1);
  });

  it("answers nothing, and is not broad, when it reaches no matter", async () => {
    const { database } = seededDatabase();
    const answer = await ask(database, "easement", {
      narrowing: mattersNamed("matter_thatDoesNotExist0000000000"),
    });
    expect(answer.broad).toBe(false);
    for (const group of answer.groups) expect(group.hits).toEqual([]);
    // Asked and empty, which is a different answer from not asked.
    expect(groupOf(answer, "notes").skipped).toBeNull();
  });

  it("names as many matters to the index as one question takes", async () => {
    const { database, raw } = seededDatabase();
    const many = Array.from(
      { length: RECORD_QUERY_MATTERS_LIMIT - 1 },
      (_, index) => `matter_narrowed${String(index).padStart(4, "0")}`,
    );
    for (const id of many) seedMatter(raw, id);
    seedNote(raw, { id: "matterNote_far", matterId: many.at(-1)!, body: "A far easement." });
    // The newest entry is on a matter outside the narrowing, and would take the one place.
    seedNote(raw, { id: "matterNote_outside", matterId: OTHER_MATTER, body: "Easement, last." });
    const answer = await ask(database, "far easement", {
      candidateCap: 1,
      narrowing: mattersNamed(MATTER, ...many),
    });
    expect(answer.broad).toBe(false);
    expect(hitIds(answer, "notes")).toEqual(["matterNote_far"]);
  });

  it("asks the firm-wide way past that, and still answers only from its matters", async () => {
    const { database, raw } = seededDatabase();
    const many = Array.from(
      { length: RECORD_QUERY_MATTERS_LIMIT + 1 },
      (_, index) => `matter_narrowed${String(index).padStart(4, "0")}`,
    );
    for (const id of many) seedMatter(raw, id);
    seedNote(raw, { id: "matterNote_far", matterId: many.at(-1)!, body: "A far easement." });
    const answer = await ask(database, "easement", { narrowing: mattersNamed(...many) });
    expect(hitIds(answer, "notes")).toEqual(["matterNote_far"]);
    // Under the firm's cap the newest match is elsewhere, the answer says so, and the narrowing
    // still holds.
    seedNote(raw, { id: "matterNote_outside", matterId: OTHER_MATTER, body: "Easement, last." });
    const capped = await ask(database, "easement", {
      candidateCap: 1,
      narrowing: mattersNamed(...many),
    });
    expect(capped.broad).toBe(true);
    expect(hitIds(capped, "notes")).toEqual([]);
  });

  it("keeps the predicate's marker, so a narrowed statement is held to the predicate", () => {
    const narrowed = narrowedVisibility(visibility, mattersNamed(MATTER));
    expect(narrowed.marker).toBe(VISIBLE_MATTER_MARKER);
    expect(narrowed.fragmentFor("matter_note.matter_id")).toContain(VISIBLE_MATTER_MARKER);
    expect(narrowed.bindings).toEqual([MATTER]);
  });
});

// The words inside files. Each matter's files are indexed apart and the index is outside the
// database, so a searcher stands in for it here and these pin the half that is this package's:
// which matters are asked, what is said when they are too many to ask, and that what the indexes
// name is only ever a list of candidates the firm's own `file` table then decides on.
describe("the words inside files, across the matters a search reaches", () => {
  interface AskedOfMatters {
    readonly matterIds: readonly string[];
    readonly queryText: string;
    readonly limit: number;
  }

  function fileSearcher(
    answer: FileContentsAnswer,
    sentences: Readonly<Record<string, string>> = {},
  ): {
    searcher: MatterFileContentsSearcher;
    asked: AskedOfMatters[];
    quoted: { matterId: string; fileIds: string[] }[];
  } {
    const asked: AskedOfMatters[] = [];
    const quoted: { matterId: string; fileIds: string[] }[] = [];
    return {
      asked,
      quoted,
      searcher: {
        query: () => {
          throw new Error("one matter's own question is not what a search across matters asks");
        },
        queryMatters: async (input) => {
          asked.push(input);
          // A searcher asked of no matter has no passages to give, whatever it would say of some.
          if (answer.kind === "passages" && input.matterIds.length === 0) {
            return { kind: "passages", passages: [] };
          }
          return answer;
        },
        excerpts: async ({ matterId, files }) => {
          quoted.push({ matterId, fileIds: files.map((file) => file.fileId) });
          return new Map(
            files.flatMap((file): [string, string][] => {
              const sentence = sentences[file.fileId];
              return sentence === undefined ? [] : [[file.fileId, sentence]];
            }),
          );
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

  const INSIDE_FILES = ["file-contents"] as const;

  it("asks the matters the reader may see, and files each result on its own matter", async () => {
    const { database } = seededDatabase();
    // The index ranks the other matter's file first. It also names a file on the platform's
    // holding matter and one the firm deleted, and neither is an answer.
    const { searcher, asked } = fileSearcher(
      passages(
        ["file_decoy", 2],
        ["file_holding", 0],
        ["file_survey", 0],
        ["file_deleted", 1],
        ["file_survey", 6],
      ),
    );
    const answer = await ask(database, "indemnify", {
      sourceKeys: INSIDE_FILES,
      fileContents: searcher,
    });
    const group = groupOf(answer, "file-contents");
    expect(group.skipped).toBeNull();
    expect(group.answerShape).toBe("ranked");
    expect(group.hits.map((hit) => [hit.id, hit.matterId, hit.secondary])).toEqual([
      ["file_decoy", OTHER_MATTER, "Page 3"],
      ["file_survey", MATTER, "Pages 1 and 7"],
    ]);
    expect(group.hits[0]?.link).toBe(`/matters/${OTHER_MATTER}/files?entry=file_decoy`);
    // Every matter the predicate admits and no other: the holding matter is not asked.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.matterIds.toSorted()).toEqual([MATTER, OTHER_MATTER].toSorted());
  });

  it("asks only the matters a narrowed search chose, and refuses a file on any other", async () => {
    const { database } = seededDatabase();
    // An index that names a file on a matter outside the narrowing is not believed.
    const { searcher, asked } = fileSearcher(passages(["file_survey", 0], ["file_decoy", 0]));
    const answer = await ask(database, "indemnify", {
      sourceKeys: INSIDE_FILES,
      fileContents: searcher,
      narrowing: mattersNamed(OTHER_MATTER),
    });
    expect(asked.map((question) => question.matterIds)).toEqual([[OTHER_MATTER]]);
    expect(hitIds(answer, "file-contents")).toEqual(["file_decoy"]);
  });

  it("does not ask a matter the reader may not see, however the search is narrowed", async () => {
    const { database } = seededDatabase();
    const { searcher, asked } = fileSearcher(passages(["file_decoy", 0], ["file_survey", 0]));
    const answer = await ask(database, "indemnify", {
      sourceKeys: INSIDE_FILES,
      fileContents: searcher,
      narrowing: mattersNamed(HOLDING_MATTER, OTHER_MATTER, MATTER),
      visibility: visibleMatterPredicateExcluding([OTHER_MATTER]),
    });
    expect(asked.map((question) => question.matterIds)).toEqual([[MATTER]]);
    expect(hitIds(answer, "file-contents")).toEqual(["file_survey"]);
  });

  it("hands the index a question built for it, and enough passages to fill the limit", async () => {
    const { database } = seededDatabase();
    const { searcher, asked } = fileSearcher(passages());
    await ask(database, 'body:/.*/ OR "hold harmless" -indemn', {
      sourceKeys: INSIDE_FILES,
      fileContents: searcher,
      limit: 10,
    });
    // Every operator the reader typed has become a word or gone; the last word is unfinished.
    expect(asked[0]?.queryText).toBe('+"body" +"OR" +"hold harmless" +body:/indemn.*/');
    // Eleven files wanted, eight passages a file.
    expect(asked[0]?.limit).toBe(88);
  });

  it("says there is more by reading one file past the limit, and quotes only what it shows", async () => {
    const { database } = seededDatabase();
    const { searcher, quoted } = fileSearcher(passages(["file_decoy", 0], ["file_survey", 0]), {
      file_decoy: "The tenant shall indemnify the landlord.",
      file_survey: "Never read.",
    });
    const answer = await ask(database, "indemnify", {
      sourceKeys: INSIDE_FILES,
      fileContents: searcher,
      limit: 1,
    });
    const group = groupOf(answer, "file-contents");
    expect(group.hits.map((hit) => hit.id)).toEqual(["file_decoy"]);
    expect(group.hasMore).toBe(true);
    expect(group.hits[0]?.snippet).toBe("The tenant shall indemnify the landlord.");
    expect(group.hits[0]?.snippetMarks).toEqual([{ start: 17, end: 26 }]);
    expect(quoted).toEqual([{ matterId: OTHER_MATTER, fileIds: ["file_decoy"] }]);
  });

  it("quotes each file through the matter the database files it on", async () => {
    const { database } = seededDatabase();
    const { searcher, quoted } = fileSearcher(passages(["file_decoy", 0], ["file_survey", 3]), {
      file_survey: "Each party shall indemnify the other.",
    });
    const answer = await ask(database, "indemnify", {
      sourceKeys: INSIDE_FILES,
      fileContents: searcher,
    });
    expect(quoted.toSorted((left, right) => left.matterId.localeCompare(right.matterId))).toEqual(
      [
        { matterId: OTHER_MATTER, fileIds: ["file_decoy"] },
        { matterId: MATTER, fileIds: ["file_survey"] },
      ].toSorted((left, right) => left.matterId.localeCompare(right.matterId)),
    );
    // The index's order is kept, and a file with no sentence still names its page.
    const group = groupOf(answer, "file-contents");
    expect(group.hits.map((hit) => [hit.id, hit.snippet, hit.secondary])).toEqual([
      ["file_decoy", null, "Page 1"],
      ["file_survey", "Each party shall indemnify the other.", "Page 4"],
    ]);
  });

  describe("when the search reaches more matters than can be asked one at a time", () => {
    function seedManyMatters(raw: Raw): void {
      for (let index = 0; index < RECORD_QUERY_MATTERS_LIMIT; index += 1) {
        seedMatter(raw, `matter_many${String(index).padStart(4, "0")}`);
      }
    }

    it("says so, asks no index, and answers nothing", async () => {
      const { database, raw } = seededDatabase();
      seedManyMatters(raw);
      const { searcher, asked } = fileSearcher(passages(["file_survey", 0]));
      const answer = await ask(database, "indemnify", {
        sourceKeys: INSIDE_FILES,
        fileContents: searcher,
      });
      const group = groupOf(answer, "file-contents");
      expect(group.skipped).toBe("too-many-matters");
      expect(group.hits).toEqual([]);
      // Asked of no matter: only whether there is an index to ask.
      expect(asked.map((question) => question.matterIds)).toEqual([[]]);
    });

    it("answers once the reader chooses few enough", async () => {
      const { database, raw } = seededDatabase();
      seedManyMatters(raw);
      const { searcher } = fileSearcher(passages(["file_survey", 0]));
      const answer = await ask(database, "indemnify", {
        sourceKeys: INSIDE_FILES,
        fileContents: searcher,
        narrowing: mattersNamed(MATTER),
      });
      expect(groupOf(answer, "file-contents").skipped).toBeNull();
      expect(hitIds(answer, "file-contents")).toEqual(["file_survey"]);
    });

    it.each([
      [{ kind: "off" }, "not-indexed"],
      [{ kind: "not-connected" }, "engine-not-connected"],
      [{ kind: "unavailable" }, "engine-unavailable"],
    ] as const)(
      "says %o first, which choosing fewer matters would not change",
      async (standing, reason) => {
        const { database, raw } = seededDatabase();
        seedManyMatters(raw);
        const answer = await ask(database, "indemnify", {
          sourceKeys: INSIDE_FILES,
          fileContents: fileSearcher(standing).searcher,
        });
        expect(groupOf(answer, "file-contents").skipped).toBe(reason);
      },
    );
  });

  it.each([
    [{ kind: "off" }, "not-indexed"],
    [{ kind: "not-connected" }, "engine-not-connected"],
    [{ kind: "unavailable" }, "engine-unavailable"],
  ] as const)("reports %o as its own reason and never as no matches", async (standing, reason) => {
    const { database } = seededDatabase();
    const answer = await ask(database, "indemnify", {
      sourceKeys: INSIDE_FILES,
      fileContents: fileSearcher(standing).searcher,
    });
    const group = groupOf(answer, "file-contents");
    expect(group.skipped).toBe(reason);
    expect(group.hits).toEqual([]);
  });

  it("says the index is not connected where nothing supplied a way to it", async () => {
    const { database } = seededDatabase();
    const absent = await ask(database, "indemnify", { sourceKeys: INSIDE_FILES });
    expect(groupOf(absent, "file-contents").skipped).toBe("engine-not-connected");
    // A searcher that answers for one matter at a time and no more is the same answer.
    const oneMatterOnly = await ask(database, "indemnify", {
      sourceKeys: INSIDE_FILES,
      fileContents: { query: async () => ({ kind: "passages", passages: [] }) },
    });
    expect(groupOf(oneMatterOnly, "file-contents").skipped).toBe("engine-not-connected");
  });

  it("answers empty, and is not skipped, for a narrowing that reaches no matter", async () => {
    const { database } = seededDatabase();
    const { searcher, asked } = fileSearcher(passages(["file_survey", 0]));
    const answer = await ask(database, "indemnify", {
      sourceKeys: INSIDE_FILES,
      fileContents: searcher,
      narrowing: mattersNamed("matter_thatDoesNotExist0000000000"),
    });
    const group = groupOf(answer, "file-contents");
    expect(group.skipped).toBeNull();
    expect(group.hits).toEqual([]);
    expect(asked.map((question) => question.matterIds)).toEqual([[]]);
  });

  it("asks nothing for text with no word in it", async () => {
    const { database } = seededDatabase();
    const { searcher, asked } = fileSearcher(passages(["file_survey", 0]));
    const answer = await ask(database, '"" --', {
      sourceKeys: INSIDE_FILES,
      fileContents: searcher,
    });
    expect(asked).toEqual([]);
    expect(groupOf(answer, "file-contents").skipped).toBeNull();
    expect(groupOf(answer, "file-contents").hits).toEqual([]);
  });

  it("leaves the record index unnamed when the reader did not narrow", async () => {
    const { database, raw } = seededDatabase();
    // Two notes written last on the other matter take both places under a cap of two. Were the
    // few matters a reader may see named to the record index, the cap would be theirs and the
    // answer would not be broad. The list read for the files' sake must not do that.
    seedNote(raw, { id: "matterNote_newer", matterId: OTHER_MATTER, body: "Easement, again." });
    seedNote(raw, { id: "matterNote_newest", matterId: OTHER_MATTER, body: "Easement, more." });
    const answer = await ask(database, "easement", {
      candidateCap: 2,
      fileContents: fileSearcher(passages()).searcher,
    });
    expect(answer.broad).toBe(true);
    expect(hitIds(answer, "notes")).toEqual(["matterNote_newer", "matterNote_newest"]);
  });
});

// The properties every source declaring `acrossMatters` must have, read off the SQL it builds.
describe("every statement a source builds for a search across matters", async () => {
  async function statements(): Promise<{ key: string; reads: string; sql: string }[]> {
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
      const request = {
        database: recorder,
        query: "easement",
        visibility,
        limit: 10,
        candidateCap: 100,
        // A source that asks an outside index first builds its statement from what it is told.
        reachedMatterIds: [MATTER],
        fileContents: {
          query: async (): Promise<FileContentsAnswer> => ({ kind: "passages", passages: [] }),
          queryMatters: async (): Promise<FileContentsAnswer> => ({
            kind: "passages",
            passages: [{ fileId: "file_survey", chunkId: "page-0" }],
          }),
        },
      };
      declaration.buildStatements(request);
      // oxlint-disable-next-line no-await-in-loop -- one source at a time, in registry order
      if (declaration.prepare !== undefined) await declaration.prepare(request);
    }
    return captured;
  }

  const EVERY_STATEMENT = await statements();

  it("is built by the sources this test expects, so a new one is read by somebody", () => {
    expect([...new Set(EVERY_STATEMENT.map((statement) => statement.key))].toSorted()).toEqual([
      "billing",
      "communications",
      "costs",
      "custody",
      "file-contents",
      "files",
      "notes",
      "parties",
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
    } else if (reads === "file-contents") {
      // The files the indexes named, by identifier, and no match of its own on anything.
      expect(sql).toMatch(/\bfile\.id IN \(\?(, \?)*\)/u);
      expect(sql).not.toContain("record_text_fts");
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

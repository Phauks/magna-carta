import { assertPermission } from "@magna-carta/access-control/registry";
import { boundedSearchSelect, likeContainsTerm, matterSectionLink } from "./build.ts";
import {
  MatterSearchSourceRegistry,
  type MatterSearchSource,
  type SourceSearchRequest,
} from "./registry.ts";
import type { MatterSearchHit, MatterSearchRawRow } from "../types.ts";

// The declared sources. Each is a read-side declaration — where the rows live, how to read a bounded
// page of them, which capability gates them, and how to project one — and NOT a write-side
// obligation on the subsystem that owns them. Adding a source is one entry here plus one statement
// builder and one projection. It is never a change to anybody's write path.
//
// Table names are tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test, the same way every other statements module tracks them.
const MATTER_NOTE_TABLE = "matter_note";
const FILE_TABLE = "file";
const FOLDER_TABLE = "folder";
const CUSTODY_PACKET_TABLE = "custody_packet";
const MATTER_PARTY_TABLE = "matter_party";
const DIRECTORY_PERSON_TABLE = "directory_person";
const DIRECTORY_ORGANIZATION_TABLE = "directory_organization";
const TIME_ENTRY_TABLE = "time_entry";
const COST_ENTRY_TABLE = "cost_entry";
const MATTER_EVENT_TABLE = "matter_event";
const MATTER_ASSET_TABLE = "matter_asset";

// A source that reads a REVIEW SET table cannot be declared here, and the fitness test in
// test/corpus-isolation.test.ts proves it over every registered statement rather than trusting this
// comment. The reason is not tidiness: packages/search/src/corpus.ts made a review set its own
// corpus precisely so that an ordinary matter search is structurally unable to name material an
// opposing party produced, which may be attorney's-eyes-only under a protective order. A matter
// search that could reach it would be a disclosure nobody authorized.

function projectInto(sourceKey: string, section: string) {
  return (row: MatterSearchRawRow): MatterSearchHit => ({
    sourceKey,
    id: row.row_id,
    title: row.title,
    snippet: row.snippet,
    secondary: row.secondary,
    actorUserId: row.actor_user_id,
    sortKey: row.sort_key,
    link: matterSectionLink(row.matter_id, section, row.row_id),
  });
}

function tooShort(request: SourceSearchRequest, minimum: number): boolean {
  return request.query.trim().length < minimum;
}

// ---- notes -----------------------------------------------------------------------------------

// The matter's notes, matched against their text.
//
// A note is ONE ROW, edited in place and deleted outright — the owner's model, and this source
// composes it rather than restating it. Two consequences worth naming, because the first cut of this
// source assumed the opposite and the merge caught it: there is no revision chain to join, so
// searching matches the words the note holds now because those are the only words it holds; and
// there is no tombstone, so a deleted note is simply absent rather than excluded by a condition.
//
// ORDERED BY WHEN THE THING HAPPENED, falling back to the day the note was written — the same
// expression the Notes tab's own list orders by. A search that put a note about Tuesday's call in a
// different place from the list it links into would make the reader check twice.
//
// The snippet is DECLARED, and this is the source where that decision is load-bearing: a note is the
// most privileged free text the platform holds. It is allowed here because every row this can return
// is a note whose body the same reader is already shown on the Notes tab this hit links into, behind
// the same notes:read capability. A firm-wide note search is a different question with a different
// answer, and it is not built here.
const NOTE_ORDERING_DATE = `COALESCE(${MATTER_NOTE_TABLE}.occurred_on, substr(${MATTER_NOTE_TABLE}.created_at, 1, 10))`;

const notesSource: MatterSearchSource = {
  key: "notes",
  sectionSlug: "notes",
  permission: assertPermission("notes:read"),
  answerShape: "listing",
  matchedFields: ["the note's text"],
  declaresSnippet: true,
  minimumQueryLength: 2,
  // A deleted note is gone rather than hidden, so there is no deleted set to include.
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    return [
      boundedSearchSelect(request.database, {
        request,
        from: MATTER_NOTE_TABLE,
        idColumn: `${MATTER_NOTE_TABLE}.id`,
        matterExpression: `${MATTER_NOTE_TABLE}.matter_id`,
        sortExpression: NOTE_ORDERING_DATE,
        // A note has no name; the reader recognizes it by when it is about, and the snippet carries
        // the words. The title is that date, rendered by the client.
        titleExpression: NOTE_ORDERING_DATE,
        snippetExpression: `${MATTER_NOTE_TABLE}.body`,
        secondaryExpression: "NULL",
        actorExpression: `${MATTER_NOTE_TABLE}.author_user_id`,
        conditions: [`${MATTER_NOTE_TABLE}.body LIKE ? ESCAPE '\\'`],
        bindings: [likeContainsTerm(request.query.trim())],
      }),
    ];
  },
  project: projectInto("notes", "notes"),
};

// ---- files -----------------------------------------------------------------------------------

// The matter's files, matched on NAME. Contents are a second half this source does not have yet: the
// keyword engine, its write pipeline and its compaction are built, but no engine is deployed, so the
// port answers engine-not-implemented and the surface says "names only" rather than implying it
// looked inside anything. Slice 3 adds the content half behind the same source key, and nothing
// above this file changes when it does.
//
// The snippet is declared ABSENT, and that is not an oversight: a file name IS the title, so an
// excerpt would be the same string twice. When contents join, the excerpt is the matching passage
// and this flips.
const filesSource: MatterSearchSource = {
  key: "files",
  sectionSlug: "files",
  // Reading a matter's file list is open to any authenticated firm member, exactly as the file list
  // route itself is — files:* gate writing and organizing, never reading.
  permission: null,
  answerShape: "listing",
  matchedFields: ["file names"],
  declaresSnippet: false,
  minimumQueryLength: 2,
  supportsDeleted: true,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    const conditions = [`${FILE_TABLE}.name LIKE ? ESCAPE '\\'`];
    // Deleted files join the answer only when asked for, and they arrive MARKED rather than
    // disguised — the client renders them on the deleted register's own quieter row, offering
    // Restore rather than a pretend live file.
    if (!request.includeDeleted) conditions.push(`${FILE_TABLE}.deleted_at IS NULL`);
    return [
      boundedSearchSelect(request.database, {
        request,
        from: `${FILE_TABLE} LEFT JOIN ${FOLDER_TABLE} ON ${FOLDER_TABLE}.id = ${FILE_TABLE}.folder_id`,
        idColumn: `${FILE_TABLE}.id`,
        matterExpression: `${FILE_TABLE}.matter_id`,
        sortExpression: `${FILE_TABLE}.created_at`,
        titleExpression: `${FILE_TABLE}.name`,
        snippetExpression: "NULL",
        // Which folder it is in, so two files of the same name are told apart without opening either.
        secondaryExpression: `${FOLDER_TABLE}.name`,
        actorExpression: "NULL",
        conditions,
        bindings: [likeContainsTerm(request.query.trim())],
      }),
    ];
  },
  project: projectInto("files", "files"),
};

// ---- custody ---------------------------------------------------------------------------------

// The physical originals held for this matter, matched on the packet's name and its custody number —
// the same two columns the custody register's own search matches, so a packet findable there is
// findable here and neither can surprise the other.
//
// One difference, and it is a repair rather than a divergence: the register's own search interpolates
// the term into a LIKE with no ESCAPE clause, so a custody number containing an underscore matches
// more than it should. Everything built here escapes, because the shared builder does it. The
// register's own route is another stream's file and is not touched from here.
const custodySource: MatterSearchSource = {
  key: "custody",
  sectionSlug: "custodian",
  permission: assertPermission("custody:read"),
  answerShape: "listing",
  matchedFields: ["packet names", "custody numbers"],
  declaresSnippet: false,
  minimumQueryLength: 2,
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    const term = likeContainsTerm(request.query.trim());
    return [
      boundedSearchSelect(request.database, {
        request,
        from: CUSTODY_PACKET_TABLE,
        idColumn: `${CUSTODY_PACKET_TABLE}.id`,
        matterExpression: `${CUSTODY_PACKET_TABLE}.matter_id`,
        sortExpression: `${CUSTODY_PACKET_TABLE}.created_at`,
        titleExpression: `${CUSTODY_PACKET_TABLE}.name`,
        snippetExpression: "NULL",
        // Where it is and what state it is in — the two facts somebody searching for an original
        // actually wants, and the reason a hit here often needs no click at all.
        secondaryExpression: `${CUSTODY_PACKET_TABLE}.custody_number || ' · ' || ${CUSTODY_PACKET_TABLE}.status`,
        actorExpression: "NULL",
        conditions: [
          `(${CUSTODY_PACKET_TABLE}.name LIKE ? ESCAPE '\\' OR ${CUSTODY_PACKET_TABLE}.custody_number LIKE ? ESCAPE '\\')`,
        ],
        bindings: [term, term],
      }),
    ];
  },
  project: projectInto("custody", "custodian"),
};

// ---- parties ---------------------------------------------------------------------------------

// The people and organizations connected to this matter, matched on the display name the firm
// records and on the capacity they act in.
//
// THE NAME IS RESOLVED BY SCALAR SUBQUERY, NOT BY JOINING THE DIRECTORY, and that is the whole
// shape of this source rather than a stylistic choice. Written as two LEFT JOINs onto
// directory_person and directory_organization — which reads more naturally and is what this source
// did first — SQLite plans a FULL SCAN of the directory: the join predicates and the COALESCE in the
// WHERE clause leave it nothing to narrow on, so a party search on a five-party matter reads every
// entity the firm has ever recorded. That is the exact failure the load-profile gate exists to
// catch (packages/fixtures/src/load-profile/matter-search-measurements.ts) — a read that grows with
// the FIRM rather than with the MATTER, invisible on a demo and ruinous on a real book.
//
// Driving from matter_party instead puts the matter's own index first, and each name is then a
// primary-key lookup on a row set bounded by the matter's party count. Exactly one of the two
// subqueries can answer, because an entity is a person or an organization and the identifier says
// which.
//
// A soft-deleted link, a soft-deleted entity and an entity merged away are all excluded, matching
// what the directory's own search excludes.
//
// It matches DISPLAY NAMES ONLY, and that is a real limit worth stating: the directory keeps every
// name an entity has ever held, so a search for a maiden name finds the woman who now goes by
// another one — but that corpus is an FTS5 trigram index this source does not read yet. Within a
// matter the party list is small and a substring scan is honest; joining the name corpus is a
// deliberate later step, not an omission nobody noticed.
//
// No snippet: a party's name IS the title, and the sensitive typed identifiers beside it are
// protected() columns that must never become an excerpt.
const PARTY_DISPLAY_NAME =
  `COALESCE(` +
  `(SELECT ${DIRECTORY_PERSON_TABLE}.display_name FROM ${DIRECTORY_PERSON_TABLE} ` +
  `WHERE ${DIRECTORY_PERSON_TABLE}.id = ${MATTER_PARTY_TABLE}.entity_id ` +
  `AND ${DIRECTORY_PERSON_TABLE}.deleted_at IS NULL AND ${DIRECTORY_PERSON_TABLE}.status = 'active'), ` +
  `(SELECT ${DIRECTORY_ORGANIZATION_TABLE}.display_name FROM ${DIRECTORY_ORGANIZATION_TABLE} ` +
  `WHERE ${DIRECTORY_ORGANIZATION_TABLE}.id = ${MATTER_PARTY_TABLE}.entity_id ` +
  `AND ${DIRECTORY_ORGANIZATION_TABLE}.deleted_at IS NULL AND ${DIRECTORY_ORGANIZATION_TABLE}.status = 'active'))`;

const partiesSource: MatterSearchSource = {
  key: "parties",
  sectionSlug: "parties",
  // Reading who is on a matter is open to any authenticated firm member, exactly as the matter's own
  // party read is. The sensitive identifiers behind those names are separately gated and are not
  // read here at all.
  permission: null,
  answerShape: "listing",
  matchedFields: ["party names", "the capacity they act in"],
  declaresSnippet: false,
  minimumQueryLength: 2,
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    const term = likeContainsTerm(request.query.trim());
    return [
      boundedSearchSelect(request.database, {
        request,
        from: MATTER_PARTY_TABLE,
        idColumn: `${MATTER_PARTY_TABLE}.id`,
        matterExpression: `${MATTER_PARTY_TABLE}.matter_id`,
        // Alphabetical, because a party list is read as a roll rather than as a history. Case-folded
        // so the order does not depend on how a name happens to be capitalized.
        sortExpression: `LOWER(${PARTY_DISPLAY_NAME})`,
        titleExpression: PARTY_DISPLAY_NAME,
        snippetExpression: "NULL",
        // What they are to this matter — the role, and the capacity where the firm recorded one.
        secondaryExpression:
          `CASE WHEN ${MATTER_PARTY_TABLE}.capacity IS NULL THEN ${MATTER_PARTY_TABLE}.role ` +
          `ELSE ${MATTER_PARTY_TABLE}.role || ' · ' || ${MATTER_PARTY_TABLE}.capacity END`,
        actorExpression: "NULL",
        conditions: [
          `${MATTER_PARTY_TABLE}.deleted_at IS NULL`,
          `${PARTY_DISPLAY_NAME} IS NOT NULL`,
          `(${PARTY_DISPLAY_NAME} LIKE ? ESCAPE '\\' OR ${MATTER_PARTY_TABLE}.capacity LIKE ? ESCAPE '\\')`,
        ],
        bindings: [term, term],
        ascending: true,
      }),
    ];
  },
  project: projectInto("parties", "parties"),
};

// ---- time ------------------------------------------------------------------------------------

// The narratives recorded against this matter — what a timekeeper wrote about the work, which is
// the only free text on a time entry and the thing somebody is looking for when they ask what was
// done about a subject.
//
// The narrative IS the snippet: unlike a file or a packet, a time entry has no name, so its title is
// the day the work was done and the words are the excerpt. That makes this the second source after
// notes where the snippet decision is load-bearing, and it lands the same way for the same reason —
// a reader holding time:read is already shown these narratives in full on the Time tab this hit
// links into.
const timeSource: MatterSearchSource = {
  key: "time",
  sectionSlug: "time",
  permission: assertPermission("time:track"),
  answerShape: "listing",
  matchedFields: ["time narratives"],
  declaresSnippet: true,
  minimumQueryLength: 2,
  // A voided entry keeps its row and stays part of the matter's record, so there is no deleted set
  // distinct from what the search already returns.
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    return [
      boundedSearchSelect(request.database, {
        request,
        from: TIME_ENTRY_TABLE,
        idColumn: `${TIME_ENTRY_TABLE}.id`,
        matterExpression: `${TIME_ENTRY_TABLE}.matter_id`,
        // The day the work was done, not the day it was typed — the order the Time tab reads in.
        sortExpression: `${TIME_ENTRY_TABLE}.work_date`,
        titleExpression: `${TIME_ENTRY_TABLE}.work_date`,
        snippetExpression: `${TIME_ENTRY_TABLE}.narrative`,
        secondaryExpression: `${TIME_ENTRY_TABLE}.status`,
        actorExpression: `${TIME_ENTRY_TABLE}.timekeeper_user_id`,
        conditions: [`${TIME_ENTRY_TABLE}.narrative LIKE ? ESCAPE '\\'`],
        bindings: [likeContainsTerm(request.query.trim())],
      }),
    ];
  },
  project: projectInto("time", "time"),
};

// ---- costs -----------------------------------------------------------------------------------

// Costs advanced and expenses incurred on this matter, matched on what the firm wrote the cost was
// for. The description is the whole point of a cost row to a person searching — "the filing fee",
// "the process server" — so it is both what matches and what is shown.
const costsSource: MatterSearchSource = {
  key: "costs",
  sectionSlug: "costs",
  permission: assertPermission("costs:track"),
  answerShape: "listing",
  matchedFields: ["cost descriptions"],
  declaresSnippet: true,
  minimumQueryLength: 2,
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    return [
      boundedSearchSelect(request.database, {
        request,
        from: COST_ENTRY_TABLE,
        idColumn: `${COST_ENTRY_TABLE}.id`,
        matterExpression: `${COST_ENTRY_TABLE}.matter_id`,
        sortExpression: `${COST_ENTRY_TABLE}.incurred_date`,
        titleExpression: `${COST_ENTRY_TABLE}.description`,
        // The description is already the title, so an excerpt would be the same string twice.
        snippetExpression: "NULL",
        secondaryExpression: `${COST_ENTRY_TABLE}.status`,
        actorExpression: "NULL",
        conditions: [`${COST_ENTRY_TABLE}.description LIKE ? ESCAPE '\\'`],
        bindings: [likeContainsTerm(request.query.trim())],
      }),
    ];
  },
  project: projectInto("costs", "costs"),
};

// ---- calendar --------------------------------------------------------------------------------

// The dates this matter is held to, matched on what a person called the event and what they wrote
// about it.
//
// NOTE THE ASYMMETRY WITH THE FEDERATED TIMELINE, which is deliberate and worth stating because the
// two reads sit over the same rows. The calendar's timeline spans every matter, so it refuses to
// project an event's title at all — free text a person wrote about a proceeding can name the people
// it concerns, and putting it on a firm-wide read would be a leak. This search is inside ONE matter,
// behind that matter's own calendar:read, on a screen that shows those titles in full. Same column,
// different reach, different answer.
const calendarSource: MatterSearchSource = {
  key: "calendar",
  sectionSlug: "calendar",
  permission: assertPermission("calendar:read"),
  answerShape: "listing",
  matchedFields: ["event titles", "event descriptions"],
  declaresSnippet: true,
  minimumQueryLength: 2,
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    const term = likeContainsTerm(request.query.trim());
    return [
      boundedSearchSelect(request.database, {
        request,
        from: MATTER_EVENT_TABLE,
        idColumn: `${MATTER_EVENT_TABLE}.id`,
        matterExpression: `${MATTER_EVENT_TABLE}.matter_id`,
        sortExpression: `${MATTER_EVENT_TABLE}.starts_on`,
        titleExpression: `${MATTER_EVENT_TABLE}.title`,
        snippetExpression: `${MATTER_EVENT_TABLE}.description`,
        // Whether it is still standing. A cancelled hearing is findable and must never look live.
        secondaryExpression: `${MATTER_EVENT_TABLE}.status`,
        actorExpression: `${MATTER_EVENT_TABLE}.recorded_by`,
        conditions: [
          `(${MATTER_EVENT_TABLE}.title LIKE ? ESCAPE '\\' OR ${MATTER_EVENT_TABLE}.description LIKE ? ESCAPE '\\')`,
        ],
        bindings: [term, term],
      }),
    ];
  },
  project: projectInto("calendar", "calendar"),
};

// ---- matter assets ---------------------------------------------------------------------------

// The register of what the client or the estate owns, matched on the firm's own description of each
// asset.
//
// IT MATCHES THE DESCRIPTION AND NOTHING ELSE, and that is a confidentiality decision rather than an
// omission. The register also holds typed identifiers — account, policy, certificate and tax numbers
// — and those are protected() columns sealed with only the last four characters readable. A search
// that matched them would be a decryption oracle: a member could confirm a full account number by
// typing it and seeing whether a row came back, without ever holding the capability to read one. The
// plaintext public-record identifiers (a parcel number, a vehicle identification number) are
// deliberately searchable by design, and joining them is a later, deliberate step — not something to
// widen into by accident.
const matterAssetsSource: MatterSearchSource = {
  key: "matterAssets",
  sectionSlug: "other",
  permission: assertPermission("matterAssets:read"),
  answerShape: "listing",
  matchedFields: ["asset descriptions"],
  declaresSnippet: false,
  minimumQueryLength: 2,
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    return [
      boundedSearchSelect(request.database, {
        request,
        from: MATTER_ASSET_TABLE,
        idColumn: `${MATTER_ASSET_TABLE}.id`,
        matterExpression: `${MATTER_ASSET_TABLE}.matter_id`,
        sortExpression: `${MATTER_ASSET_TABLE}.created_at`,
        titleExpression: `${MATTER_ASSET_TABLE}.description`,
        snippetExpression: "NULL",
        secondaryExpression: `${MATTER_ASSET_TABLE}.class`,
        actorExpression: "NULL",
        conditions: [`${MATTER_ASSET_TABLE}.description LIKE ? ESCAPE '\\'`],
        bindings: [likeContainsTerm(request.query.trim())],
      }),
    ];
  },
  project: projectInto("matterAssets", "other"),
};

// The registry, in the order the matter's own section strip reads. A group renders in this order, so
// the answer and the tabs above it never disagree about where things live.
export const matterSearchSources = new MatterSearchSourceRegistry([
  filesSource,
  timeSource,
  costsSource,
  partiesSource,
  notesSource,
  custodySource,
  calendarSource,
  matterAssetsSource,
]);

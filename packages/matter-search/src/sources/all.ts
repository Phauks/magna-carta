import { assertPermission } from "@magna-carta/access-control/registry";
import {
  boundedSearchSelect,
  likeContainsTerm,
  matterSectionLink,
  recordIndexLeadingMatch,
  recordIndexMatch,
  recordIndexNewestMatch,
  visibleMattersSearchSelect,
  type SearchRowColumns,
} from "./build.ts";
import {
  MatterSearchSourceRegistry,
  type MatterSearchSource,
  type SourceSearchRequest,
} from "./registry.ts";
import { keywordQueryText } from "@magna-carta/search/keyword-query";
import {
  arrangeByCandidates,
  candidatesFrom,
  passagesToAskFor,
  quoteCandidates,
} from "../file-contents.ts";
import type { MatterSearchHit, MatterSearchRawRow } from "../types.ts";

// The declared sources. Each is a read-side declaration — where the rows live, how to read a bounded
// page of them, which capability gates them, and how to project one — and NOT a write-side
// obligation on the subsystem that owns them. Adding a source is one entry here plus one statement
// builder and one projection. It is never a change to anybody's write path.
//
// Table names are tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test, the same way every other statements module tracks them.
//
// TWO KINDS OF MATCH, chosen by what the reader means. A source whose text is PROSE — a note, a
// narrative, a cost description, an event, what was said on a call — matches words through the
// firm's record index (`recordIndexLeadingMatch`), so the read follows the records that match and
// is not a pass over every row of the matter.
// A source whose text is a NAME or a NUMBER — a file, a folder, a party, a custody number, an
// invoice number, a telephone number — matches characters with LIKE on its own column, because a
// person typing part of a name or the last four digits of a number means exactly those characters.
// The index is a source's to use only if @magna-carta/search declares that source
// (record-index-sources.ts); the key handed to the match is that declaration's key.
//
// A THIRD KIND reads the words INSIDE a file, which are in neither a column nor the record index:
// they are in the file contents index the search service reads. That source asks the index first
// and then reads its own table, and it is the only one with a `prepare` step.
const MATTER_NOTE_TABLE = "matter_note";
const FILE_TABLE = "file";
const FOLDER_TABLE = "folder";
const CUSTODY_PACKET_TABLE = "custody_packet";
const COMMUNICATION_TABLE = "communication";
const MATTER_PARTY_TABLE = "matter_party";
const DIRECTORY_PERSON_TABLE = "directory_person";
const DIRECTORY_ORGANIZATION_TABLE = "directory_organization";
const TIME_ENTRY_TABLE = "time_entry";
const COST_ENTRY_TABLE = "cost_entry";
const MATTER_EVENT_TABLE = "matter_event";
const INVOICE_LINE_TABLE = "invoice_line";
const INVOICE_TABLE = "invoice";

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
    matterId: row.matter_id,
    title: row.title,
    // Where the reader's words are is said afterwards, by the runner (marks.ts), from the source's
    // own `marking`. A projection knows the row and not the question.
    titleMarks: [],
    snippet: row.snippet,
    snippetMarks: [],
    secondary: row.secondary,
    actorUserId: row.actor_user_id,
    sortKey: row.sort_key,
    // The row's identity, unless the source declared a different thing to open.
    link: matterSectionLink(row.matter_id, section, row.link_id ?? row.row_id),
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
// the same notes:read capability. The search across matters answers with the same rows under the
// same capability, and is declared separately below (`acrossMatters`).
const NOTE_ORDERING_DATE = `COALESCE(${MATTER_NOTE_TABLE}.occurred_on, substr(${MATTER_NOTE_TABLE}.created_at, 1, 10))`;

const NOTE_ROW: SearchRowColumns = {
  idColumn: `${MATTER_NOTE_TABLE}.id`,
  matterExpression: `${MATTER_NOTE_TABLE}.matter_id`,
  sortExpression: NOTE_ORDERING_DATE,
  // A note has no name; the reader recognizes it by when it is about, and the snippet carries the
  // words. The title is that date, rendered by the client.
  titleExpression: NOTE_ORDERING_DATE,
  snippetExpression: `${MATTER_NOTE_TABLE}.body`,
  secondaryExpression: "NULL",
  actorExpression: `${MATTER_NOTE_TABLE}.author_user_id`,
};

const notesSource: MatterSearchSource = {
  key: "notes",
  sectionSlug: "notes",
  permission: assertPermission("notes:read"),
  answerShape: "listing",
  matchedFields: ["the note's text"],
  declaresSnippet: true,
  // The title is a date. The words are in the body, matched through the record index.
  marking: { title: null, snippet: "record-words" },
  minimumQueryLength: 2,
  // A deleted note is gone rather than hidden, so there is no deleted set to include.
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    const match = recordIndexLeadingMatch(request, "notes", MATTER_NOTE_TABLE);
    if (match === null) return [];
    return [
      boundedSearchSelect(request.database, {
        request,
        from: match.from,
        ...NOTE_ROW,
        conditions: [match.condition],
        bindings: [match.binding],
      }),
    ];
  },
  project: projectInto("notes", "notes"),
  // The same rows, the same body and the same notes:read, on every matter the reader may see. The
  // excerpt is allowed for the reason it is allowed inside a matter: each hit is a note this reader
  // is shown in full on the Notes tab it links to. What decides WHICH matters is the visible-matter
  // predicate alone, so a matter that becomes closed to a reader leaves their search with it.
  acrossMatters: {
    reads: "record-index",
    matchedFields: ["the note's text"],
    buildStatements: (request) => {
      const match = recordIndexNewestMatch(request, "notes", MATTER_NOTE_TABLE);
      if (match === null) return [];
      return [
        visibleMattersSearchSelect(request.database, {
          request,
          ...match,
          ...NOTE_ROW,
          conditions: [],
          bindings: [],
        }),
      ];
    },
  },
};

// ---- files -----------------------------------------------------------------------------------

// The matter's files AND ITS FOLDERS, matched on NAME. The words inside a file are a different
// question with a different kind of answer, and they are the next source's (`file-contents`).
//
// FOLDERS ARE THE SECOND STATEMENT, not a source of their own. A person who names a folder and then
// searches for it is searching the Files section — putting folders in a group of their own would
// split one question across two headings and make the reader pick the right one before they had
// found anything. It was reported as a plain defect: searching a matter for "New Folder" answered
// nothing while the folder sat in the tree.
//
// Two statements per source is a shape the runner supports, and run.ts merges their rows by sort key
// before applying the limit — without that, a matter with more matching files than the limit would
// silently drop every folder.
//
// A folder has no deleted set: the folder tree is organizational only and folders are removed
// outright rather than soft-deleted, so `includeDeleted` changes the file statement and leaves this
// one alone. That is why the folder statement carries no deleted_at condition rather than having
// forgotten one.
//
// The snippet is declared ABSENT, and that is not an oversight: a file name IS the title, so an
// excerpt would be the same string twice.
const filesSource: MatterSearchSource = {
  key: "files",
  sectionSlug: "files",
  // Reading a matter's file list is open to any authenticated firm member, exactly as the file list
  // route itself is — files:* gate writing and organizing, never reading.
  permission: null,
  answerShape: "listing",
  matchedFields: ["file names", "folder names"],
  declaresSnippet: false,
  // A name is matched as the characters typed, wherever they fall in it.
  marking: { title: "characters", snippet: null },
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
        // Which folder it is in, so two files of the same name are told apart without opening
        // either — and, on a file the firm has deleted, that fact FIRST. A deleted file that came
        // back looking live is the one outcome the option must not produce: somebody would act on
        // a document that is not in the matter any more.
        secondaryExpression:
          `CASE WHEN ${FILE_TABLE}.deleted_at IS NULL THEN ${FOLDER_TABLE}.name ` +
          `WHEN ${FOLDER_TABLE}.name IS NULL THEN 'Deleted' ` +
          `ELSE 'Deleted · ' || ${FOLDER_TABLE}.name END`,
        actorExpression: "NULL",
        conditions,
        bindings: [likeContainsTerm(request.query.trim())],
      }),
      // The folders themselves. Named as folders in the second line, because a folder and a file
      // can carry the same name and the reader has to be able to tell which one they are opening.
      boundedSearchSelect(request.database, {
        request,
        from: FOLDER_TABLE,
        idColumn: `${FOLDER_TABLE}.id`,
        matterExpression: `${FOLDER_TABLE}.matter_id`,
        sortExpression: `${FOLDER_TABLE}.created_at`,
        titleExpression: `${FOLDER_TABLE}.name`,
        snippetExpression: "NULL",
        secondaryExpression: "'Folder'",
        actorExpression: "NULL",
        conditions: [`${FOLDER_TABLE}.name LIKE ? ESCAPE '\\'`],
        bindings: [likeContainsTerm(request.query.trim())],
      }),
    ];
  },
  project: projectInto("files", "files"),
  // File and folder names on every matter the reader may see. A name is characters and not words,
  // so this reads the firm's file and folder rows instead of the record index, and its cost grows
  // with how many files the firm holds; scripts/measure-across-matters.mts is the reading that says
  // a firm's file list is short enough to read. Deleted files are never part of this answer: the
  // option that brings them back belongs to the matter's own search, beside the register it reads.
  acrossMatters: {
    reads: "names",
    matchedFields: ["file names", "folder names"],
    buildStatements: (request) => {
      const term = likeContainsTerm(request.query);
      return [
        visibleMattersSearchSelect(request.database, {
          request,
          from: `${FILE_TABLE} LEFT JOIN ${FOLDER_TABLE} ON ${FOLDER_TABLE}.id = ${FILE_TABLE}.folder_id`,
          idColumn: `${FILE_TABLE}.id`,
          matterExpression: `${FILE_TABLE}.matter_id`,
          sortExpression: `${FILE_TABLE}.created_at`,
          titleExpression: `${FILE_TABLE}.name`,
          snippetExpression: "NULL",
          secondaryExpression: `${FOLDER_TABLE}.name`,
          actorExpression: "NULL",
          conditions: [`${FILE_TABLE}.name LIKE ? ESCAPE '\\'`, `${FILE_TABLE}.deleted_at IS NULL`],
          bindings: [term],
        }),
        visibleMattersSearchSelect(request.database, {
          request,
          from: FOLDER_TABLE,
          idColumn: `${FOLDER_TABLE}.id`,
          matterExpression: `${FOLDER_TABLE}.matter_id`,
          sortExpression: `${FOLDER_TABLE}.created_at`,
          titleExpression: `${FOLDER_TABLE}.name`,
          snippetExpression: "NULL",
          secondaryExpression: "'Folder'",
          actorExpression: "NULL",
          conditions: [`${FOLDER_TABLE}.name LIKE ? ESCAPE '\\'`],
          bindings: [term],
        }),
      ];
    },
  },
};

// ---- file contents ---------------------------------------------------------------------------

// The words INSIDE the matter's files. A second source on the Files section, and a separate group
// in the answer on purpose: a name match is a listing in the file list's own order, and a match
// inside a document is ranked by how well the passage answers. Folding the two into one group would
// put a ranked answer in a listing's order or a listing in a ranked one, and either reads as
// something it is not. A file whose name and text both match appears in both groups, and each says
// why it is there.
//
// The index is asked for passages and answers with file identifiers. It is not believed about
// anything else: `fileContentsStatement` re-reads those files from the firm's own table through the
// same bounded builder as every other source, so the matter binding and the visibility predicate
// decide what is returned. That is also what keeps a discovery review set out of reach. The
// application asks the index for this matter's corpus and no other, and a review document is not a
// row of the `file` table this statement reads.
//
// The statement selects no excerpt, and a result may still carry one. The index holds which words
// are on which page and not the sentences, and a document's text is not in the firm's database, so
// there is nothing for SQL to select. The sentence is read afterwards, from where the application
// keeps each indexed version's text, for the rows this statement returned and a reader is about to
// be shown (`quoteCandidates`). A file that cannot be quoted names its pages alone.
function fileContentsStatement(request: SourceSearchRequest, fileIds: readonly string[]) {
  const conditions = [`${FILE_TABLE}.id IN (${fileIds.map(() => "?").join(", ")})`];
  // The same rule as a name match: a deleted file answers only when asked for, and arrives marked.
  if (!request.includeDeleted) conditions.push(`${FILE_TABLE}.deleted_at IS NULL`);
  return boundedSearchSelect(request.database, {
    request,
    from: `${FILE_TABLE} LEFT JOIN ${FOLDER_TABLE} ON ${FOLDER_TABLE}.id = ${FILE_TABLE}.folder_id`,
    idColumn: `${FILE_TABLE}.id`,
    matterExpression: `${FILE_TABLE}.matter_id`,
    sortExpression: `${FILE_TABLE}.created_at`,
    titleExpression: `${FILE_TABLE}.name`,
    snippetExpression: "NULL",
    secondaryExpression:
      `CASE WHEN ${FILE_TABLE}.deleted_at IS NULL THEN ${FOLDER_TABLE}.name ` +
      `WHEN ${FOLDER_TABLE}.name IS NULL THEN 'Deleted' ` +
      `ELSE 'Deleted · ' || ${FOLDER_TABLE}.name END`,
    actorExpression: "NULL",
    conditions,
    bindings: [...fileIds],
  });
}

const fileContentsSource: MatterSearchSource = {
  key: "file-contents",
  sectionSlug: "files",
  // Behind the same door as the file list: any member of the firm may read a matter's files.
  permission: null,
  answerShape: "ranked",
  matchedFields: ["the text inside files"],
  // The sentence the words were found in. Any member of the firm may open the file it comes from,
  // on the screen the result links to.
  declaresSnippet: true,
  // The words are inside the file and not in its name, so the sentence is marked and the name is
  // not. The files group above is where a name that matched is marked.
  marking: { title: null, snippet: "file-words" },
  minimumQueryLength: 2,
  supportsDeleted: true,
  // Nothing to build without the index's answer. The statement is `fileContentsStatement`, built in
  // `prepare` once the candidates are known.
  buildStatements: () => [],
  prepare: async (request) => {
    const searcher = request.fileContents ?? null;
    // Nothing supplied a way to the index. Said as "not connected", never as "no matches".
    if (searcher === null) return { kind: "skipped", reason: "engine-not-connected" };
    const queryText = tooShort(request, 2) ? null : keywordQueryText(request.query);
    if (queryText === null) return { kind: "candidates", statements: [], arrange: () => [] };
    // One more file than the limit, so the group can say there is more without counting.
    const fileLimit = request.limit + 1;
    const answer = await searcher.query({
      matterId: request.matterId,
      queryText,
      limit: passagesToAskFor(fileLimit),
    });
    if (answer.kind === "off") return { kind: "skipped", reason: "not-indexed" };
    if (answer.kind === "not-connected") return { kind: "skipped", reason: "engine-not-connected" };
    if (answer.kind === "unavailable") return { kind: "skipped", reason: "engine-unavailable" };
    const candidates = candidatesFrom(answer.passages, fileLimit);
    if (candidates.length === 0) return { kind: "candidates", statements: [], arrange: () => [] };
    return {
      kind: "candidates",
      statements: [
        fileContentsStatement(
          request,
          candidates.map((candidate) => candidate.fileId),
        ),
      ],
      arrange: (rows) => arrangeByCandidates(rows, candidates),
      quote: (rows) =>
        quoteCandidates(rows, candidates, {
          matterId: request.matterId,
          readerText: request.query,
          searcher,
        }),
    };
  },
  project: projectInto("file-contents", "files"),
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
  // The packet's name as characters. The custody number matches too and is in the second line,
  // which is a composed label and is left unmarked.
  marking: { title: "characters", snippet: null },
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

// ---- calls and texts ---------------------------------------------------------------------------

// What the firm said on this matter, matched on the words AND on the number.
//
// THE NUMBER IS IN THE MATCH ON PURPOSE, and it is the half people actually use. Somebody hunting
// for a text remembers the number they dialled far more reliably than a phrase inside it, and a
// search that only read the body would silently fail the commonest way anybody looks for one.
//
// It matches the SUMMARY as well as the body, which is what makes calls findable at all: a voice row
// has no message text, and what a member wrote down about the call is the only words it holds.
//
// UNROUTED ROWS ARE OUT OF SCOPE HERE BY CONSTRUCTION, not by a condition — a matter search is
// scoped to one matter, and a row waiting in the queue is on none. The firm-wide screen's own search
// is where those are found.
const COMMUNICATION_ROW: SearchRowColumns = {
  idColumn: `${COMMUNICATION_TABLE}.id`,
  matterExpression: `${COMMUNICATION_TABLE}.matter_id`,
  sortExpression: `${COMMUNICATION_TABLE}.occurred_at`,
  // A call has no name; the reader recognizes it by when it happened, and the snippet carries the
  // words. The title is that instant, rendered by the client.
  titleExpression: `${COMMUNICATION_TABLE}.occurred_at`,
  snippetExpression: `COALESCE(${COMMUNICATION_TABLE}.body, ${COMMUNICATION_TABLE}.summary)`,
  // What it was and which way it went — the two facts that tell a reader whether the hit is the
  // conversation they meant before they open it.
  secondaryExpression: `${COMMUNICATION_TABLE}.channel || ' · ' || ${COMMUNICATION_TABLE}.direction`,
  actorExpression: `${COMMUNICATION_TABLE}.member_user_id`,
};

const communicationsSource: MatterSearchSource = {
  key: "communications",
  sectionSlug: "messaging",
  permission: assertPermission("communications:read"),
  answerShape: "listing",
  matchedFields: ["what was said", "the caller's name", "the number"],
  declaresSnippet: true,
  // The title is an instant. What was said is marked by its words; a call found by its number or
  // by the caller's name shows what was said with nothing marked, because neither is in it.
  marking: { title: null, snippet: "record-words" },
  minimumQueryLength: 2,
  // A logged call is edited or left alone, never soft-deleted, so there is no deleted set.
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    // Two halves, and either can answer. The words go to the record index; the number is matched as
    // characters on its own column, because somebody typing "0142" means those digits wherever they
    // fall in the number and a word match would refuse them. Text with no letter or digit in it
    // leaves only the number half. Because it is one OR the other, this table leads and the index
    // is asked as a subquery: a matter's calls and texts are few enough to read.
    const numberCondition = `${COMMUNICATION_TABLE}.counterparty_number LIKE ? ESCAPE '\\'`;
    const numberTerm = likeContainsTerm(request.query.trim());
    const match = recordIndexMatch(request, "communications", `${COMMUNICATION_TABLE}.id`);
    return [
      boundedSearchSelect(request.database, {
        request,
        from: COMMUNICATION_TABLE,
        ...COMMUNICATION_ROW,
        conditions: [
          match === null ? numberCondition : `(${match.condition} OR ${numberCondition})`,
        ],
        bindings: match === null ? [numberTerm] : [match.binding, numberTerm],
      }),
    ];
  },
  project: projectInto("communications", "messaging"),
  // Across matters the words alone answer, and the number does not. Inside a matter the number is
  // matched by reading that matter's calls and texts, which are few; with no matter to narrow by,
  // the same match would read every call and text the firm has logged. A row waiting in the queue
  // on no matter is still out of reach here: the visible-matter predicate asks for a matter.
  acrossMatters: {
    reads: "record-index",
    matchedFields: ["what was said", "the caller's name"],
    buildStatements: (request) => {
      const match = recordIndexNewestMatch(request, "communications", COMMUNICATION_TABLE);
      if (match === null) return [];
      return [
        visibleMattersSearchSelect(request.database, {
          request,
          ...match,
          ...COMMUNICATION_ROW,
          conditions: [],
          bindings: [],
        }),
      ];
    },
  },
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
  marking: { title: "characters", snippet: null },
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
const TIME_ROW: SearchRowColumns = {
  idColumn: `${TIME_ENTRY_TABLE}.id`,
  matterExpression: `${TIME_ENTRY_TABLE}.matter_id`,
  // The day the work was done, not the day it was typed — the order the Time tab reads in.
  sortExpression: `${TIME_ENTRY_TABLE}.work_date`,
  titleExpression: `${TIME_ENTRY_TABLE}.work_date`,
  snippetExpression: `${TIME_ENTRY_TABLE}.narrative`,
  secondaryExpression: `${TIME_ENTRY_TABLE}.status`,
  actorExpression: `${TIME_ENTRY_TABLE}.timekeeper_user_id`,
};

const timeSource: MatterSearchSource = {
  key: "time",
  sectionSlug: "time",
  permission: assertPermission("time:track"),
  answerShape: "listing",
  matchedFields: ["time narratives"],
  declaresSnippet: true,
  // The title is the day the work was done. The narrative is marked by its words.
  marking: { title: null, snippet: "record-words" },
  minimumQueryLength: 2,
  // A voided entry keeps its row and stays part of the matter's record, so there is no deleted set
  // distinct from what the search already returns.
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    const match = recordIndexLeadingMatch(request, "time", TIME_ENTRY_TABLE);
    if (match === null) return [];
    return [
      boundedSearchSelect(request.database, {
        request,
        from: match.from,
        ...TIME_ROW,
        conditions: [match.condition],
        bindings: [match.binding],
      }),
    ];
  },
  project: projectInto("time", "time"),
  acrossMatters: {
    reads: "record-index",
    matchedFields: ["time narratives"],
    buildStatements: (request) => {
      const match = recordIndexNewestMatch(request, "time", TIME_ENTRY_TABLE);
      if (match === null) return [];
      return [
        visibleMattersSearchSelect(request.database, {
          request,
          ...match,
          ...TIME_ROW,
          conditions: [],
          bindings: [],
        }),
      ];
    },
  },
};

// ---- costs -----------------------------------------------------------------------------------

// Costs advanced and expenses incurred on this matter, matched on what the firm wrote the cost was
// for. The description is the whole point of a cost row to a person searching — "the filing fee",
// "the process server" — so it is both what matches and what is shown.
const COST_ROW: SearchRowColumns = {
  idColumn: `${COST_ENTRY_TABLE}.id`,
  matterExpression: `${COST_ENTRY_TABLE}.matter_id`,
  sortExpression: `${COST_ENTRY_TABLE}.incurred_date`,
  titleExpression: `${COST_ENTRY_TABLE}.description`,
  // The description is already the title, so an excerpt would be the same string twice.
  snippetExpression: "NULL",
  secondaryExpression: `${COST_ENTRY_TABLE}.status`,
  actorExpression: "NULL",
};

const costsSource: MatterSearchSource = {
  key: "costs",
  sectionSlug: "costs",
  permission: assertPermission("costs:track"),
  answerShape: "listing",
  matchedFields: ["cost descriptions"],
  declaresSnippet: true,
  // The description is the title, and it is what the record index matched.
  marking: { title: "record-words", snippet: null },
  minimumQueryLength: 2,
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    const match = recordIndexLeadingMatch(request, "costs", COST_ENTRY_TABLE);
    if (match === null) return [];
    return [
      boundedSearchSelect(request.database, {
        request,
        from: match.from,
        ...COST_ROW,
        conditions: [match.condition],
        bindings: [match.binding],
      }),
    ];
  },
  project: projectInto("costs", "costs"),
  acrossMatters: {
    reads: "record-index",
    matchedFields: ["cost descriptions"],
    buildStatements: (request) => {
      const match = recordIndexNewestMatch(request, "costs", COST_ENTRY_TABLE);
      if (match === null) return [];
      return [
        visibleMattersSearchSelect(request.database, {
          request,
          ...match,
          ...COST_ROW,
          conditions: [],
          bindings: [],
        }),
      ];
    },
  },
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
//
// It declares no `acrossMatters` for the same reason. A search across matters is the wider reach
// again, and whether an event's title may be shown on it is the owner's to decide, as it was for
// the timeline; until then a search across matters says events are not searched there.
const calendarSource: MatterSearchSource = {
  key: "calendar",
  sectionSlug: "calendar",
  permission: assertPermission("calendar:read"),
  answerShape: "listing",
  matchedFields: ["event titles", "event descriptions"],
  declaresSnippet: true,
  marking: { title: "record-words", snippet: "record-words" },
  minimumQueryLength: 2,
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    const match = recordIndexLeadingMatch(request, "calendar", MATTER_EVENT_TABLE);
    if (match === null) return [];
    return [
      boundedSearchSelect(request.database, {
        request,
        from: match.from,
        idColumn: `${MATTER_EVENT_TABLE}.id`,
        matterExpression: `${MATTER_EVENT_TABLE}.matter_id`,
        sortExpression: `${MATTER_EVENT_TABLE}.starts_on`,
        titleExpression: `${MATTER_EVENT_TABLE}.title`,
        snippetExpression: `${MATTER_EVENT_TABLE}.description`,
        // Whether it is still standing. A cancelled hearing is findable and must never look live.
        secondaryExpression: `${MATTER_EVENT_TABLE}.status`,
        actorExpression: `${MATTER_EVENT_TABLE}.recorded_by`,
        conditions: [match.condition],
        bindings: [match.binding],
      }),
    ];
  },
  project: projectInto("calendar", "calendar"),
};

// ---- matter assets: no source, deliberately ---------------------------------------------------

// There is no matter-assets source, and the reason is a missing DESTINATION rather than a missing
// query. Every hit here is a reference — `matterSectionLink` sends the reader to the section that
// owns the row, on the screen built to show it — and the asset register has no such section: the
// matter strip holds fourteen, none of which is an asset schedule. A source would return rows whose
// link is a 404, which is worse for a reader than a scope option that is honestly absent.
//
// When the register does get a screen, the source is a small thing to write, and two constraints
// found while designing it should survive to that day. It matches `matter_asset.description` and
// NOTHING else: the register also holds typed identifiers — account, policy, certificate and tax
// numbers — which are protected() columns sealed with only the last four characters readable, and a
// search that matched them would be a decryption oracle (a member could confirm a full account
// number by typing it and seeing whether a row came back, without ever holding the capability to
// read one). The plaintext public-record identifiers — a parcel number, a vehicle identification
// number — are searchable by design, and joining them is a later, deliberate step rather than
// something to widen into by accident.

// ---- billing ---------------------------------------------------------------------------------

// The bills that charge this matter, matched on what each line says it is for and on the invoice's
// own number.
//
// DRIVEN FROM invoice_line, WHICH IS THE ONLY TABLE HERE THAT KNOWS THE MATTER. An invoice belongs
// to a client and may bill several of that client's matters, so `invoice` carries no matter at all;
// the reach is `invoice_line.matter_id`, and its (matter_id, invoice_id) index is what keeps the
// narrowing index-served. That ordering is not incidental — the parties source proved that a join
// is exactly where a matter filter goes wrong quietly, and this is the second join in the registry.
//
// THE ROW IS A LINE AND THE DESTINATION IS AN INVOICE, which is why `linkIdExpression` exists. The
// line is the right identity — it is what matched, and it is what a keyset walks — while the Billing
// tab is organised by invoice, so a link carrying the line id would land on a page that cannot
// resolve it. Two different facts, kept as two.
const billingSource: MatterSearchSource = {
  key: "billing",
  sectionSlug: "billing",
  permission: assertPermission("billing:read"),
  answerShape: "listing",
  matchedFields: ["invoice line descriptions", "invoice numbers"],
  declaresSnippet: false,
  // The line's description as characters. An invoice number matches too and is in the second
  // line, which is a composed label and is left unmarked.
  marking: { title: "characters", snippet: null },
  minimumQueryLength: 2,
  supportsDeleted: false,
  buildStatements: (request) => {
    if (tooShort(request, 2)) return [];
    const term = likeContainsTerm(request.query.trim());
    const invoiceNumber =
      `(SELECT ${INVOICE_TABLE}.invoice_number FROM ${INVOICE_TABLE} ` +
      `WHERE ${INVOICE_TABLE}.id = ${INVOICE_LINE_TABLE}.invoice_id)`;
    const invoiceStatus =
      `(SELECT ${INVOICE_TABLE}.status FROM ${INVOICE_TABLE} ` +
      `WHERE ${INVOICE_TABLE}.id = ${INVOICE_LINE_TABLE}.invoice_id)`;
    return [
      boundedSearchSelect(request.database, {
        request,
        from: INVOICE_LINE_TABLE,
        idColumn: `${INVOICE_LINE_TABLE}.id`,
        linkIdExpression: `${INVOICE_LINE_TABLE}.invoice_id`,
        matterExpression: `${INVOICE_LINE_TABLE}.matter_id`,
        sortExpression: `${INVOICE_LINE_TABLE}.created_at`,
        titleExpression: `${INVOICE_LINE_TABLE}.description`,
        snippetExpression: "NULL",
        // The bill it is on and where that bill stands. A draft has no number yet, and saying
        // "Draft" is the honest reading of a null rather than an empty cell.
        secondaryExpression: `COALESCE(${invoiceNumber}, 'Draft') || ' · ' || COALESCE(${invoiceStatus}, 'draft')`,
        actorExpression: "NULL",
        conditions: [
          `(${INVOICE_LINE_TABLE}.description LIKE ? ESCAPE '\\' OR ${invoiceNumber} LIKE ? ESCAPE '\\')`,
        ],
        bindings: [term, term],
      }),
    ];
  },
  project: projectInto("billing", "billing"),
};

// The registry, in the order the matter's own section strip reads. A group renders in this order, so
// the answer and the tabs above it never disagree about where things live.
export const matterSearchSources = new MatterSearchSourceRegistry([
  filesSource,
  fileContentsSource,
  timeSource,
  costsSource,
  billingSource,
  partiesSource,
  calendarSource,
  notesSource,
  custodySource,
  communicationsSource,
]);

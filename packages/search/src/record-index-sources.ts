// The RECORD INDEX is the firm's full-text index over the short text that lives in database rows — a
// note's body, a time narrative, what was said on a call, a task, a Magnus conversation. It is the
// counterpart of the keyword engine (port.ts), which indexes the words inside FILES: file text is bulk
// content and lives in object storage, record text is already in the firm's database and is indexed
// beside it.
//
// This module is the list of what feeds it. A place becomes searchable by ONE declaration here: which
// table holds its rows, which columns are its words, which matter a row belongs to, and when a row is
// in or out. Everything else is derived from the declaration — the triggers that keep the index
// current (record-index-schema.ts), the statements that rebuild it, and the conditions a reader's
// query is narrowed by (record-index-query.ts). Nothing that writes a note, a time entry or a turn
// knows the index exists, which is what makes it impossible for a write path to forget it.
//
// WHY AN INDEX AT ALL, when a matter search used to scan these tables directly: a scan is honest only
// while something fences it. Inside one matter the fence is the matter, and a note table holds tens of
// rows. A conflicts check and a search across matters have no such fence — they read the firm, and a
// firm holds every narrative every timekeeper ever wrote. The index is what lets those two exist
// without reading every row for every question.
//
// WHAT IS DELIBERATELY NOT HERE. Names and numbers — a file's name, a party's name, a custody number,
// an invoice number — are matched by substring on their own columns, because a person searching for
// "0142" means the characters and not a word. Sensitive identifiers held in protected columns are
// never indexed anywhere: an index over them would be a way to confirm a value without holding the
// capability to read it. And no source may read a review-set table, for the reason corpus.ts gives:
// material an opposing party produced is searched only from inside its own review set.

// One declared source of record text.
//
// Every SQL fragment below is a code-supplied literal over the source's own table (and its container,
// where it has one), written with QUALIFIED column names so the same fragment reads correctly inside a
// trigger, a rebuild and a join. Nothing here is ever request input.
export interface RecordIndexSource {
  // Stable, and STORED: it is written into every index row and into the scope token a query narrows
  // by, so it is permanent once a firm's database holds a row carrying it. Lowercase letters and
  // hyphens only.
  readonly key: string;
  // What a person calls this place, for a screen that lists what is searchable.
  readonly label: string;
  // What is matched, in the reader's words.
  readonly matchedFields: readonly string[];
  // The table whose rows are indexed, one index row per table row.
  readonly table: string;
  // The record a reader opens when that is not the row itself, and the table that decides the row's
  // matter and whether it is searchable at all. A Magnus turn is the row that holds the words; the
  // conversation is what a person opens, what is filed on a matter, and what is deleted.
  readonly container: RecordIndexContainer | null;
  // The matter this row belongs to, or an expression that is NULL where it is on none.
  readonly matterExpression: string;
  // The order a reader expects this place's records in — the day the thing happened where the row
  // records one. Never NULL.
  readonly sortExpression: string;
  // The short text a record is recognized by, or the literal NULL where it has none.
  readonly titleExpression: string;
  // The record's words, or the literal NULL where the title is all it holds.
  readonly bodyExpression: string;
  // When a row is searchable, or null for always. A row that stops satisfying this leaves the index
  // in the same statement that changed it.
  readonly includeWhen: string | null;
  // The columns of `table` whose change can alter anything above. A write that touches none of them
  // does not touch the index, which is what keeps a status change on a time entry from re-indexing
  // its narrative.
  readonly reindexOn: readonly string[];
}

export interface RecordIndexContainer {
  readonly table: string;
  // The column of the source's table that names its container row.
  readonly foreignKey: string;
  // The container columns whose change re-indexes every row under it: the matter it is filed on, and
  // whatever takes it out of view.
  readonly reindexOn: readonly string[];
}

const MATTER_NOTE_TABLE = "matter_note";
const TIME_ENTRY_TABLE = "time_entry";
const COST_ENTRY_TABLE = "cost_entry";
const MATTER_EVENT_TABLE = "matter_event";
const COMMUNICATION_TABLE = "communication";
const MATTER_TASK_TABLE = "matter_task";
const MAGNUS_CONVERSATION_TABLE = "magnus_conversation";
const MAGNUS_TURN_TABLE = "magnus_turn";

// A note's text, in the order the Notes tab reads: by the day the note is about, falling back to the
// day it was written. A note is one row, edited in place and deleted outright, so the index holds the
// words it has now and nothing it used to say.
const notesSource: RecordIndexSource = {
  key: "notes",
  label: "Notes",
  matchedFields: ["the note's text"],
  table: MATTER_NOTE_TABLE,
  container: null,
  matterExpression: `${MATTER_NOTE_TABLE}.matter_id`,
  sortExpression: `COALESCE(${MATTER_NOTE_TABLE}.occurred_on, substr(${MATTER_NOTE_TABLE}.created_at, 1, 10))`,
  titleExpression: "NULL",
  bodyExpression: `${MATTER_NOTE_TABLE}.body`,
  includeWhen: null,
  reindexOn: ["matter_id", "body", "occurred_on"],
};

// What a timekeeper wrote about the work. The internal memo beside it is not indexed: it is a
// reviewer's remark about the entry rather than a description of the work, and it is not shown where
// a narrative is.
const timeSource: RecordIndexSource = {
  key: "time",
  label: "Time",
  matchedFields: ["time narratives"],
  table: TIME_ENTRY_TABLE,
  container: null,
  matterExpression: `${TIME_ENTRY_TABLE}.matter_id`,
  sortExpression: `${TIME_ENTRY_TABLE}.work_date`,
  titleExpression: "NULL",
  bodyExpression: `${TIME_ENTRY_TABLE}.narrative`,
  includeWhen: null,
  reindexOn: ["matter_id", "narrative", "work_date"],
};

const costsSource: RecordIndexSource = {
  key: "costs",
  label: "Costs",
  matchedFields: ["cost descriptions"],
  table: COST_ENTRY_TABLE,
  container: null,
  matterExpression: `${COST_ENTRY_TABLE}.matter_id`,
  sortExpression: `${COST_ENTRY_TABLE}.incurred_date`,
  titleExpression: `${COST_ENTRY_TABLE}.description`,
  bodyExpression: "NULL",
  includeWhen: null,
  reindexOn: ["matter_id", "description", "incurred_date"],
};

// A cancelled event stays searchable, because it stays on the matter's calendar: somebody looking for
// the hearing that was vacated has to be able to find that it was.
const calendarSource: RecordIndexSource = {
  key: "calendar",
  label: "Calendar",
  matchedFields: ["event titles", "event descriptions"],
  table: MATTER_EVENT_TABLE,
  container: null,
  matterExpression: `${MATTER_EVENT_TABLE}.matter_id`,
  sortExpression: `${MATTER_EVENT_TABLE}.starts_on`,
  titleExpression: `${MATTER_EVENT_TABLE}.title`,
  bodyExpression: `${MATTER_EVENT_TABLE}.description`,
  includeWhen: null,
  reindexOn: ["matter_id", "title", "description", "starts_on"],
};

// Calls and texts. The summary is the title because it is the only words a call has; a text's own
// words are the body. A row that is filed on no matter yet is indexed with no matter, so a firm-wide
// read can find it and a matter read cannot.
//
// The caller's name as the carrier reported it is indexed with the summary: it is what a person
// remembers about a call they did not take.
const communicationsSource: RecordIndexSource = {
  key: "communications",
  label: "Messaging",
  matchedFields: ["what was said", "the caller's name"],
  table: COMMUNICATION_TABLE,
  container: null,
  matterExpression: `${COMMUNICATION_TABLE}.matter_id`,
  sortExpression: `${COMMUNICATION_TABLE}.occurred_at`,
  titleExpression:
    `NULLIF(TRIM(COALESCE(${COMMUNICATION_TABLE}.summary, '') || ' ' || ` +
    `COALESCE(${COMMUNICATION_TABLE}.caller_id_name, '')), '')`,
  bodyExpression: `${COMMUNICATION_TABLE}.body`,
  includeWhen: null,
  reindexOn: ["matter_id", "summary", "caller_id_name", "body", "occurred_at"],
};

// A task keeps its place in the index when it is done, cancelled or archived. Those are states a
// reader filters by on the task's own screen; they are not reasons a conflicts check should fail to
// see a name written in one.
const tasksSource: RecordIndexSource = {
  key: "tasks",
  label: "Tasks",
  matchedFields: ["task titles", "task descriptions"],
  table: MATTER_TASK_TABLE,
  container: null,
  matterExpression: `${MATTER_TASK_TABLE}.matter_id`,
  sortExpression: `${MATTER_TASK_TABLE}.created_at`,
  titleExpression: `${MATTER_TASK_TABLE}.title`,
  bodyExpression: `${MATTER_TASK_TABLE}.body`,
  includeWhen: null,
  reindexOn: ["matter_id", "title", "body"],
};

// A Magnus conversation's title. A deleted conversation leaves the index when it is deleted, and
// returns if it is restored.
const magnusConversationsSource: RecordIndexSource = {
  key: "magnus-conversations",
  label: "Magnus",
  matchedFields: ["conversation titles"],
  table: MAGNUS_CONVERSATION_TABLE,
  container: null,
  matterExpression: `${MAGNUS_CONVERSATION_TABLE}.matter_id`,
  sortExpression: `${MAGNUS_CONVERSATION_TABLE}.created_at`,
  titleExpression: `${MAGNUS_CONVERSATION_TABLE}.title`,
  bodyExpression: "NULL",
  includeWhen: `${MAGNUS_CONVERSATION_TABLE}.deleted_at IS NULL`,
  reindexOn: ["matter_id", "title", "deleted_at"],
};

// What was asked of Magnus and what it answered, one index row per settled turn. A turn has no matter
// of its own and is never deleted by itself: both facts belong to the conversation, so the
// conversation is its container and a change to either re-indexes every turn under it.
//
// Only a COMPLETE turn is indexed. A pending turn has no words yet, and a failed or refused one holds
// a closed label rather than anything a person wrote.
const magnusTurnsSource: RecordIndexSource = {
  key: "magnus-turns",
  label: "Magnus",
  matchedFields: ["what was asked", "what Magnus answered"],
  table: MAGNUS_TURN_TABLE,
  container: {
    table: MAGNUS_CONVERSATION_TABLE,
    foreignKey: "conversation_id",
    reindexOn: ["matter_id", "deleted_at"],
  },
  matterExpression: `${MAGNUS_CONVERSATION_TABLE}.matter_id`,
  sortExpression: `${MAGNUS_TURN_TABLE}.created_at`,
  titleExpression: "NULL",
  bodyExpression: `${MAGNUS_TURN_TABLE}.content`,
  includeWhen: `${MAGNUS_TURN_TABLE}.status = 'complete' AND ${MAGNUS_CONVERSATION_TABLE}.deleted_at IS NULL`,
  reindexOn: ["content", "status"],
};

// The declared sources. The order is the order a screen lists them in.
//
// ADDING ONE IS A MIGRATION, and the fitness test beside this package says so before a reviewer has
// to: the triggers a firm's database carries are rendered from this list, so a list that has moved
// ahead of the applied migrations is a list of places that are declared searchable and are not being
// indexed. The migration is the rendering of the new source — its triggers and its fill statements —
// appended to the per-firm lineage.
export const recordIndexSources: readonly RecordIndexSource[] = [
  notesSource,
  timeSource,
  costsSource,
  calendarSource,
  communicationsSource,
  tasksSource,
  magnusConversationsSource,
  magnusTurnsSource,
];

export type RecordIndexSourceKey = (typeof recordIndexSources)[number]["key"];

const SOURCE_KEY_SHAPE = /^[a-z]+(?:-[a-z]+)*$/u;

// The source carrying a key, or a thrown error for one that was never declared. A consumer names its
// source by a literal, so an unknown key is a programming mistake and is reported as one rather than
// as an empty answer that reads like "nothing matched".
export function recordIndexSource(key: string): RecordIndexSource {
  const source = recordIndexSources.find((candidate) => candidate.key === key);
  if (source === undefined) throw new Error(`no record index source is declared as "${key}"`);
  return source;
}

// Refuses a list that could not be rendered safely: a key that is not the stored shape, or two
// sources claiming one key. Run by the renderer, so a malformed declaration fails when the migration
// is written rather than when a firm's database applies it.
export function assertRecordIndexSources(sources: readonly RecordIndexSource[]): void {
  const keys = new Set<string>();
  for (const source of sources) {
    if (!SOURCE_KEY_SHAPE.test(source.key)) {
      throw new Error(
        `record index source key "${source.key}" must be lowercase words and hyphens`,
      );
    }
    if (keys.has(source.key)) throw new Error(`duplicate record index source key: ${source.key}`);
    keys.add(source.key);
    if (source.reindexOn.length === 0) {
      throw new Error(`record index source "${source.key}" names no column that re-indexes it`);
    }
  }
}

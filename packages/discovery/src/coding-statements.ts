import {
  assemblePage,
  decodeCursor,
  keysetClause,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  ReviewDocumentId,
  ReviewDocumentTagId,
  ReviewSetId,
  ReviewTagEventId,
  ReviewTagGroupId,
  ReviewTagId,
  UserId,
} from "@magna-carta/identifiers/types";
import { REVIEW_DOCUMENT_TABLE } from "./review-document-statements.ts";
import type { ReviewSetAccessPredicate } from "./review-set-visibility.ts";
import type {
  ReviewTagEventKind,
  ReviewTagEventScope,
  ReviewTagEventState,
  ReviewTagGroupCardinality,
  ReviewTagGroupKind,
  ReviewTagSemantic,
} from "./types.ts";

// Every read and write of a review set's coding, with the access predicate composed into the SQL.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: no builder here takes the predicate as optional, and no
// builder applies it after the rows come back. `test/review-set-visibility-fitness.test.ts`
// enumerates ACCESS_SCOPED_BUILDERS at the bottom of this file and proves, for each one, that the
// predicate's marker appears in the statement, inside the WHERE clause, and ahead of the LIMIT.
// Adding a builder without registering it there fails that test's own not-vacuous check.
//
// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const REVIEW_TAG_GROUP_TABLE = "review_tag_group";
export const REVIEW_TAG_TABLE = "review_tag";
export const REVIEW_TAG_EVENT_TABLE = "review_tag_event";
export const REVIEW_DOCUMENT_TAG_TABLE = "review_document_tag";

export interface ReviewTagGroupRow {
  readonly id: ReviewTagGroupId;
  readonly review_set_id: ReviewSetId;
  readonly name: string;
  readonly kind: ReviewTagGroupKind;
  readonly cardinality: ReviewTagGroupCardinality;
  readonly required_for_completion: number;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ReviewTagRow {
  readonly id: ReviewTagId;
  readonly review_tag_group_id: ReviewTagGroupId;
  readonly review_set_id: ReviewSetId;
  readonly name: string;
  readonly semantic: ReviewTagSemantic | null;
  readonly color_token: string;
  readonly sort_order: number;
  readonly active: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ReviewTagEventRow {
  readonly id: ReviewTagEventId;
  readonly review_set_id: ReviewSetId;
  readonly kind: ReviewTagEventKind;
  readonly review_tag_id: ReviewTagId;
  readonly scope: ReviewTagEventScope;
  readonly document_count: number;
  readonly criteria: string | null;
  readonly selection_r2_key: string | null;
  readonly state: ReviewTagEventState;
  readonly reverses_event_id: ReviewTagEventId | null;
  readonly actor_user_id: UserId;
  readonly created_at: string;
  readonly completed_at: string | null;
}

export interface ReviewDocumentTagRow {
  readonly id: ReviewDocumentTagId;
  readonly review_set_id: ReviewSetId;
  readonly review_document_id: ReviewDocumentId;
  readonly review_tag_id: ReviewTagId;
  readonly review_tag_group_id: ReviewTagGroupId;
  readonly single_choice: number;
  readonly applied_by_event_id: ReviewTagEventId;
  readonly applied_at: string;
  readonly removed_by_event_id: ReviewTagEventId | null;
  readonly removed_at: string | null;
}

const TAG_GROUP_COLUMNS =
  "id, review_set_id, name, kind, cardinality, required_for_completion, sort_order, created_at, " +
  "updated_at";

const TAG_COLUMNS =
  "id, review_tag_group_id, review_set_id, name, semantic, color_token, sort_order, active, " +
  "created_at, updated_at";

const TAG_EVENT_COLUMNS =
  "id, review_set_id, kind, review_tag_id, scope, document_count, criteria, selection_r2_key, " +
  "state, reverses_event_id, actor_user_id, created_at, completed_at";

const DOCUMENT_TAG_COLUMNS =
  "id, review_set_id, review_document_id, review_tag_id, review_tag_group_id, single_choice, " +
  "applied_by_event_id, applied_at, removed_by_event_id, removed_at";

// ---------------------------------------------------------------------------------------------
// The coding panel — the review set's questions and their answers.

export function selectTagGroupsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${TAG_GROUP_COLUMNS} FROM ${REVIEW_TAG_GROUP_TABLE} ` +
        `WHERE ${REVIEW_TAG_GROUP_TABLE}.review_set_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_TAG_GROUP_TABLE}.review_set_id`)} ` +
        `ORDER BY sort_order ASC, id ASC LIMIT ?`,
    )
    .bind(reviewSetId, ...access.bindings, limit);
}

export async function readTagGroups(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): Promise<ReviewTagGroupRow[]> {
  const { results } = await selectTagGroupsStatement(
    database,
    reviewSetId,
    access,
    limit,
  ).all<ReviewTagGroupRow>();
  return results;
}

// Every tag of the review set in one read rather than one read per group: the panel is a handful of
// groups and a few dozen tags, and the alternative is an N+1 whose N is set by how a firm chose to
// organize its questions.
export function selectTagsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${TAG_COLUMNS} FROM ${REVIEW_TAG_TABLE} ` +
        `WHERE ${REVIEW_TAG_TABLE}.review_set_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_TAG_TABLE}.review_set_id`)} ` +
        `ORDER BY review_tag_group_id ASC, sort_order ASC, id ASC LIMIT ?`,
    )
    .bind(reviewSetId, ...access.bindings, limit);
}

export async function readTags(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): Promise<ReviewTagRow[]> {
  const { results } = await selectTagsStatement(
    database,
    reviewSetId,
    access,
    limit,
  ).all<ReviewTagRow>();
  return results;
}

// One tag, for the service to check its group, cardinality and review set before an application.
// Access-scoped like everything else: a tag id from another firm's corpus resolves to nothing rather
// than to a row whose review set the caller then compares.
export function selectTagStatement(
  database: SqlDatabase,
  reviewTagId: ReviewTagId,
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${TAG_COLUMNS} FROM ${REVIEW_TAG_TABLE} ` +
        `WHERE ${REVIEW_TAG_TABLE}.id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_TAG_TABLE}.review_set_id`)} LIMIT ?`,
    )
    .bind(reviewTagId, ...access.bindings, 1);
}

export async function readTag(
  database: SqlDatabase,
  reviewTagId: ReviewTagId,
  access: ReviewSetAccessPredicate,
): Promise<ReviewTagRow | undefined> {
  const { results } = await selectTagStatement(database, reviewTagId, access).all<ReviewTagRow>();
  return results[0];
}

export function selectTagGroupStatement(
  database: SqlDatabase,
  reviewTagGroupId: ReviewTagGroupId,
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${TAG_GROUP_COLUMNS} FROM ${REVIEW_TAG_GROUP_TABLE} ` +
        `WHERE ${REVIEW_TAG_GROUP_TABLE}.id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_TAG_GROUP_TABLE}.review_set_id`)} LIMIT ?`,
    )
    .bind(reviewTagGroupId, ...access.bindings, 1);
}

export async function readTagGroup(
  database: SqlDatabase,
  reviewTagGroupId: ReviewTagGroupId,
  access: ReviewSetAccessPredicate,
): Promise<ReviewTagGroupRow | undefined> {
  const { results } = await selectTagGroupStatement(
    database,
    reviewTagGroupId,
    access,
  ).all<ReviewTagGroupRow>();
  return results[0];
}

export function insertTagGroupStatement(
  database: SqlDatabase,
  row: {
    id: ReviewTagGroupId;
    reviewSetId: ReviewSetId;
    name: string;
    kind: ReviewTagGroupKind;
    cardinality: ReviewTagGroupCardinality;
    requiredForCompletion: boolean;
    sortOrder: number;
    now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${REVIEW_TAG_GROUP_TABLE} ` +
        `(id, review_set_id, name, kind, cardinality, required_for_completion, sort_order, ` +
        `created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.reviewSetId,
      row.name,
      row.kind,
      row.cardinality,
      row.requiredForCompletion ? 1 : 0,
      row.sortOrder,
      row.now,
      row.now,
    );
}

export function insertTagStatement(
  database: SqlDatabase,
  row: {
    id: ReviewTagId;
    reviewTagGroupId: ReviewTagGroupId;
    reviewSetId: ReviewSetId;
    name: string;
    semantic: ReviewTagSemantic | null;
    colorToken: string;
    sortOrder: number;
    now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${REVIEW_TAG_TABLE} ` +
        `(id, review_tag_group_id, review_set_id, name, semantic, color_token, sort_order, active, ` +
        `created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      row.id,
      row.reviewTagGroupId,
      row.reviewSetId,
      row.name,
      row.semantic,
      row.colorToken,
      row.sortOrder,
      row.now,
      row.now,
    );
}

// Renaming is the only edit a group takes. Nothing matches a group by name, so a rename changes what
// a reviewer reads and nothing else.
export function renameTagGroupStatement(
  database: SqlDatabase,
  reviewTagGroupId: ReviewTagGroupId,
  name: string,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${REVIEW_TAG_GROUP_TABLE} SET name = ?, updated_at = ? WHERE id = ?`)
    .bind(name, now, reviewTagGroupId);
}

export function renameTagStatement(
  database: SqlDatabase,
  reviewTagId: ReviewTagId,
  name: string,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${REVIEW_TAG_TABLE} SET name = ?, updated_at = ? WHERE id = ?`)
    .bind(name, now, reviewTagId);
}

// A tag is DEACTIVATED, never deleted: deleting one would orphan the coding history that is the whole
// point of the journal. Deactivating hides it from the panel and leaves every row it ever wrote
// readable and attributable.
export function setTagActiveStatement(
  database: SqlDatabase,
  reviewTagId: ReviewTagId,
  active: boolean,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${REVIEW_TAG_TABLE} SET active = ?, updated_at = ? WHERE id = ?`)
    .bind(active ? 1 : 0, now, reviewTagId);
}

export function selectTagGroupNameTakenStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  name: string,
): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${REVIEW_TAG_GROUP_TABLE} WHERE review_set_id = ? AND name = ?`)
    .bind(reviewSetId, name);
}

export async function tagGroupNameIsTaken(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  name: string,
): Promise<boolean> {
  const { results } = await selectTagGroupNameTakenStatement(database, reviewSetId, name).all<{
    id: ReviewTagGroupId;
  }>();
  return results.length > 0;
}

export function selectTagNameTakenStatement(
  database: SqlDatabase,
  reviewTagGroupId: ReviewTagGroupId,
  name: string,
): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${REVIEW_TAG_TABLE} WHERE review_tag_group_id = ? AND name = ?`)
    .bind(reviewTagGroupId, name);
}

export async function tagNameIsTaken(
  database: SqlDatabase,
  reviewTagGroupId: ReviewTagGroupId,
  name: string,
): Promise<boolean> {
  const { results } = await selectTagNameTakenStatement(database, reviewTagGroupId, name).all<{
    id: ReviewTagId;
  }>();
  return results.length > 0;
}

// The next free sort position, so a firm adding a question does not have to invent one.
export function selectNextTagGroupSortOrderStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM ${REVIEW_TAG_GROUP_TABLE} ` +
        `WHERE review_set_id = ?`,
    )
    .bind(reviewSetId);
}

export async function readNextTagGroupSortOrder(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): Promise<number> {
  const { results } = await selectNextTagGroupSortOrderStatement(database, reviewSetId).all<{
    next_sort_order: number;
  }>();
  return results[0]?.next_sort_order ?? 0;
}

export function selectNextTagSortOrderStatement(
  database: SqlDatabase,
  reviewTagGroupId: ReviewTagGroupId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM ${REVIEW_TAG_TABLE} ` +
        `WHERE review_tag_group_id = ?`,
    )
    .bind(reviewTagGroupId);
}

export async function readNextTagSortOrder(
  database: SqlDatabase,
  reviewTagGroupId: ReviewTagGroupId,
): Promise<number> {
  const { results } = await selectNextTagSortOrderStatement(database, reviewTagGroupId).all<{
    next_sort_order: number;
  }>();
  return results[0]?.next_sort_order ?? 0;
}

// ---------------------------------------------------------------------------------------------
// The event journal — one row per human act.

export function insertTagEventStatement(
  database: SqlDatabase,
  row: {
    id: ReviewTagEventId;
    reviewSetId: ReviewSetId;
    kind: ReviewTagEventKind;
    reviewTagId: ReviewTagId;
    scope: ReviewTagEventScope;
    documentCount: number;
    criteria: string | null;
    selectionR2Key: string | null;
    state: ReviewTagEventState;
    reversesEventId: ReviewTagEventId | null;
    actorUserId: UserId;
    now: string;
    completedAt: string | null;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${REVIEW_TAG_EVENT_TABLE} ` +
        `(id, review_set_id, kind, review_tag_id, scope, document_count, criteria, ` +
        `selection_r2_key, state, reverses_event_id, actor_user_id, created_at, completed_at) ` +
        `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.reviewSetId,
      row.kind,
      row.reviewTagId,
      row.scope,
      row.documentCount,
      row.criteria,
      row.selectionR2Key,
      row.state,
      row.reversesEventId,
      row.actorUserId,
      row.now,
      row.completedAt,
    );
}

// A bulk operation that dies part-way leaves its event `running` with the rows it did write still
// attributed to it. That is the honest record, and it is what an undo of a partial operation reverses.
export function completeTagEventStatement(
  database: SqlDatabase,
  eventId: ReviewTagEventId,
  documentCount: number,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_TAG_EVENT_TABLE} SET state = 'complete', document_count = ?, ` +
        `completed_at = ? WHERE id = ? AND state = 'running'`,
    )
    .bind(documentCount, now, eventId);
}

// The undone event STAYS in the journal, pointing at its reversal. History never shortens.
export function markTagEventUndoneStatement(
  database: SqlDatabase,
  eventId: ReviewTagEventId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_TAG_EVENT_TABLE} SET state = 'undone' WHERE id = ? AND state = 'complete'`,
    )
    .bind(eventId);
}

export function selectTagEventStatement(
  database: SqlDatabase,
  eventId: ReviewTagEventId,
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${TAG_EVENT_COLUMNS} FROM ${REVIEW_TAG_EVENT_TABLE} ` +
        `WHERE ${REVIEW_TAG_EVENT_TABLE}.id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_TAG_EVENT_TABLE}.review_set_id`)} LIMIT ?`,
    )
    .bind(eventId, ...access.bindings, 1);
}

export async function readTagEvent(
  database: SqlDatabase,
  eventId: ReviewTagEventId,
  access: ReviewSetAccessPredicate,
): Promise<ReviewTagEventRow | undefined> {
  const { results } = await selectTagEventStatement(
    database,
    eventId,
    access,
  ).all<ReviewTagEventRow>();
  return results[0];
}

// The journal, newest first. This is the read a meet-and-confer stands on: who coded what, when, one
// at a time or in bulk, under what criteria, and who reversed it.
export function selectTagEventPageStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
  cursor?: SortCursor,
): SqlStatement {
  // The keyset clause sits between the access fragment and the ORDER BY, so the predicate still
  // precedes the LIMIT — which is the property the visibility fitness test asserts on this builder.
  const bindings: unknown[] = [reviewSetId, ...access.bindings];
  const cursorClause = keysetClause(bindings, cursor, "created_at", "id", false);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${TAG_EVENT_COLUMNS} FROM ${REVIEW_TAG_EVENT_TABLE} ` +
        `WHERE ${REVIEW_TAG_EVENT_TABLE}.review_set_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_TAG_EVENT_TABLE}.review_set_id`)} ` +
        cursorClause +
        `ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

/**
 * The journal, newest first, a page at a time.
 *
 * It carried a LIMIT and no cursor, which on THIS read is the worst place for it: a corpus with more
 * coding acts than fit a page answered with the most recent fifty and nothing saying the rest
 * existed. The whole value of the journal is that it is complete — a meet-and-confer stands on it,
 * and an answer silently truncated to the last fifty acts is an answer that omits exactly the
 * history a challenge is about.
 */
export async function readTagEventPage(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  pageSize: number,
  cursor?: string,
): Promise<Page<ReviewTagEventRow>> {
  const { results } = await selectTagEventPageStatement(
    database,
    reviewSetId,
    access,
    // One more than the page, as the has-more probe.
    pageSize + 1,
    decodeCursor(cursor),
  ).all<ReviewTagEventRow>();
  return assemblePage(results, pageSize, (row) => row);
}

// ---------------------------------------------------------------------------------------------
// Applying and removing — the per-document rows.

// INSERT ... SELECT rather than INSERT ... VALUES, so the access predicate rides INSIDE the write.
// The service has already resolved this document through an access-scoped read; composing the
// predicate again here means a service bug cannot write into a corpus the actor cannot reach, which
// is the one class of mistake worth paying a subquery for.
//
// `OR IGNORE` against the two partial unique indexes: a repeated apply of the same tag converges on
// the row already there, and a single-choice answer that lost a race with a concurrent writer is
// dropped rather than aborting the whole batch. The service pairs a single-choice apply with the
// removal of the previous answer in the SAME batch, so the ordinary path never depends on the race.
export function applyDocumentTagStatement(
  database: SqlDatabase,
  row: {
    id: ReviewDocumentTagId;
    reviewSetId: ReviewSetId;
    reviewDocumentId: ReviewDocumentId;
    reviewTagId: ReviewTagId;
    reviewTagGroupId: ReviewTagGroupId;
    singleChoice: boolean;
    appliedByEventId: ReviewTagEventId;
    now: string;
  },
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO ${REVIEW_DOCUMENT_TAG_TABLE} ` +
        `(id, review_set_id, review_document_id, review_tag_id, review_tag_group_id, ` +
        `single_choice, applied_by_event_id, applied_at) ` +
        `SELECT ?, ${REVIEW_DOCUMENT_TABLE}.review_set_id, ${REVIEW_DOCUMENT_TABLE}.id, ?, ?, ?, ?, ? ` +
        `FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE ${REVIEW_DOCUMENT_TABLE}.id = ? AND ${REVIEW_DOCUMENT_TABLE}.review_set_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TABLE}.review_set_id`)}`,
    )
    .bind(
      row.id,
      row.reviewTagId,
      row.reviewTagGroupId,
      row.singleChoice ? 1 : 0,
      row.appliedByEventId,
      row.now,
      row.reviewDocumentId,
      row.reviewSetId,
      ...access.bindings,
    );
}

// Removal is a STATE, not a deletion: an actor and an instant land on the row and it stays readable
// forever. That is what makes the coding history of one document one indexed read years later.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function removeDocumentTagStatement(
  database: SqlDatabase,
  target: {
    reviewSetId: ReviewSetId;
    reviewDocumentId: ReviewDocumentId;
    reviewTagId: ReviewTagId;
    removedByEventId: ReviewTagEventId;
    now: string;
  },
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TAG_TABLE} SET removed_at = ?, removed_by_event_id = ? ` +
        `WHERE ${REVIEW_DOCUMENT_TAG_TABLE}.review_document_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TAG_TABLE}.review_tag_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TAG_TABLE}.removed_at IS NULL ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id`)}`,
    )
    .bind(
      target.now,
      target.removedByEventId,
      target.reviewDocumentId,
      target.reviewTagId,
      target.reviewSetId,
      ...access.bindings,
    );
}

// Clearing the previous answer in a single-choice group, so changing one is remove-plus-apply in one
// batch. Written by group rather than by tag because the caller does not know, and should not have to
// read, which answer is currently there.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function clearSingleChoiceGroupStatement(
  database: SqlDatabase,
  target: {
    reviewSetId: ReviewSetId;
    reviewDocumentId: ReviewDocumentId;
    reviewTagGroupId: ReviewTagGroupId;
    removedByEventId: ReviewTagEventId;
    now: string;
  },
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TAG_TABLE} SET removed_at = ?, removed_by_event_id = ? ` +
        `WHERE ${REVIEW_DOCUMENT_TAG_TABLE}.review_document_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TAG_TABLE}.review_tag_group_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TAG_TABLE}.removed_at IS NULL ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id`)}`,
    )
    .bind(
      target.now,
      target.removedByEventId,
      target.reviewDocumentId,
      target.reviewTagGroupId,
      target.reviewSetId,
      ...access.bindings,
    );
}

// What is coded on this document right now, with the tag and group joined in so the panel renders
// from one read.
export function selectDocumentCodingStatement(
  database: SqlDatabase,
  reviewDocumentId: ReviewDocumentId,
  access: ReviewSetAccessPredicate,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DOCUMENT_TAG_COLUMNS} FROM ${REVIEW_DOCUMENT_TAG_TABLE} ` +
        `WHERE ${REVIEW_DOCUMENT_TAG_TABLE}.review_document_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TAG_TABLE}.removed_at IS NULL ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id`)} ` +
        `ORDER BY review_tag_group_id ASC, review_tag_id ASC LIMIT ?`,
    )
    .bind(reviewDocumentId, ...access.bindings, limit);
}

export async function readDocumentCoding(
  database: SqlDatabase,
  reviewDocumentId: ReviewDocumentId,
  access: ReviewSetAccessPredicate,
  limit: number,
): Promise<ReviewDocumentTagRow[]> {
  const { results } = await selectDocumentCodingStatement(
    database,
    reviewDocumentId,
    access,
    limit,
  ).all<ReviewDocumentTagRow>();
  return results;
}

// The whole coding history of one document, removed rows included. "Who tagged what when" as ONE
// indexed read years later, which is why removal is a state and not a deletion.
export function selectDocumentCodingHistoryStatement(
  database: SqlDatabase,
  reviewDocumentId: ReviewDocumentId,
  access: ReviewSetAccessPredicate,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DOCUMENT_TAG_COLUMNS} FROM ${REVIEW_DOCUMENT_TAG_TABLE} ` +
        `WHERE ${REVIEW_DOCUMENT_TAG_TABLE}.review_document_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id`)} ` +
        `ORDER BY applied_at DESC, id DESC LIMIT ?`,
    )
    .bind(reviewDocumentId, ...access.bindings, limit);
}

export async function readDocumentCodingHistory(
  database: SqlDatabase,
  reviewDocumentId: ReviewDocumentId,
  access: ReviewSetAccessPredicate,
  limit: number,
): Promise<ReviewDocumentTagRow[]> {
  const { results } = await selectDocumentCodingHistoryStatement(
    database,
    reviewDocumentId,
    access,
    limit,
  ).all<ReviewDocumentTagRow>();
  return results;
}

// The documents a `family` gesture reaches: the named document and everything sharing its family
// identifier. Resolved through an access-scoped read, so a family that spans nothing the caller may
// see resolves to nothing rather than to a count they can infer from.
export function selectFamilyDocumentIdsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  reviewDocumentId: ReviewDocumentId,
  access: ReviewSetAccessPredicate,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT member.id AS id FROM ${REVIEW_DOCUMENT_TABLE} AS member ` +
        `JOIN ${REVIEW_DOCUMENT_TABLE} AS named ON named.family_id = member.family_id ` +
        `WHERE named.id = ? AND member.review_set_id = ? ` +
        `AND ${access.fragmentFor("member.review_set_id")} ` +
        `ORDER BY member.family_sequence ASC, member.id ASC LIMIT ?`,
    )
    .bind(reviewDocumentId, reviewSetId, ...access.bindings, limit);
}

export async function readFamilyDocumentIds(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  reviewDocumentId: ReviewDocumentId,
  access: ReviewSetAccessPredicate,
  limit: number,
): Promise<ReviewDocumentId[]> {
  const { results } = await selectFamilyDocumentIdsStatement(
    database,
    reviewSetId,
    reviewDocumentId,
    access,
    limit,
  ).all<{ id: ReviewDocumentId }>();
  return results.map((result) => result.id);
}

// Which of a named list of documents actually belong to this review set AND are reachable. The bulk
// path resolves its selection through this before writing anything: a selection is client input, and
// a document id from another corpus must vanish from it rather than be refused in a way that confirms
// the id exists.
export function selectReachableDocumentIdsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  reviewDocumentIds: readonly ReviewDocumentId[],
  access: ReviewSetAccessPredicate,
  limit: number,
): SqlStatement {
  const placeholders = reviewDocumentIds.map(() => "?").join(", ");
  return database
    .prepare(
      `SELECT ${REVIEW_DOCUMENT_TABLE}.id AS id FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE ${REVIEW_DOCUMENT_TABLE}.review_set_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TABLE}.id IN (${placeholders}) ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TABLE}.review_set_id`)} ` +
        `ORDER BY ${REVIEW_DOCUMENT_TABLE}.id ASC LIMIT ?`,
    )
    .bind(reviewSetId, ...reviewDocumentIds, ...access.bindings, limit);
}

export async function readReachableDocumentIds(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  reviewDocumentIds: readonly ReviewDocumentId[],
  access: ReviewSetAccessPredicate,
  limit: number,
): Promise<ReviewDocumentId[]> {
  if (reviewDocumentIds.length === 0) return [];
  const { results } = await selectReachableDocumentIdsStatement(
    database,
    reviewSetId,
    reviewDocumentIds,
    access,
    limit,
  ).all<{ id: ReviewDocumentId }>();
  return results.map((result) => result.id);
}

// ---------------------------------------------------------------------------------------------
// Undo — compensation, and exact.

// Undoing an apply removes PRECISELY the rows that event wrote and which are still live. A tag
// somebody else applied afterwards has its own row and its own event and is untouched; a row already
// removed keeps its original removal attribution.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function undoAppliedRowsStatement(
  database: SqlDatabase,
  target: { undoneEventId: ReviewTagEventId; undoEventId: ReviewTagEventId; now: string },
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TAG_TABLE} SET removed_at = ?, removed_by_event_id = ? ` +
        `WHERE ${REVIEW_DOCUMENT_TAG_TABLE}.applied_by_event_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TAG_TABLE}.removed_at IS NULL ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id`)}`,
    )
    .bind(target.now, target.undoEventId, target.undoneEventId, ...access.bindings);
}

// Undoing a remove re-applies by the same rule: rows removed by that event and not since re-applied.
// Clearing the removal restores the row's ORIGINAL apply attribution, which is the honest record — the
// application really was made by the person the row already names, and the undo event in the journal
// is what says the removal was taken back.
//
// The two NOT EXISTS guards are what keep the restore from aborting on the partial unique indexes: if
// somebody has since re-applied the same tag, or answered the same single-choice group differently,
// that live row wins and this one stays removed. Guarding in SQL rather than reading first means two
// concurrent undos cannot both decide the coast is clear.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function undoRemovedRowsStatement(
  database: SqlDatabase,
  target: { undoneEventId: ReviewTagEventId },
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TAG_TABLE} SET removed_at = NULL, removed_by_event_id = NULL ` +
        `WHERE ${REVIEW_DOCUMENT_TAG_TABLE}.removed_by_event_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id`)} ` +
        `AND NOT EXISTS (SELECT 1 FROM ${REVIEW_DOCUMENT_TAG_TABLE} AS live ` +
        `WHERE live.review_document_id = ${REVIEW_DOCUMENT_TAG_TABLE}.review_document_id ` +
        `AND live.review_tag_id = ${REVIEW_DOCUMENT_TAG_TABLE}.review_tag_id ` +
        `AND live.removed_at IS NULL) ` +
        `AND NOT EXISTS (SELECT 1 FROM ${REVIEW_DOCUMENT_TAG_TABLE} AS answered ` +
        `WHERE answered.review_document_id = ${REVIEW_DOCUMENT_TAG_TABLE}.review_document_id ` +
        `AND answered.review_tag_group_id = ${REVIEW_DOCUMENT_TAG_TABLE}.review_tag_group_id ` +
        `AND answered.single_choice = 1 AND ${REVIEW_DOCUMENT_TAG_TABLE}.single_choice = 1 ` +
        `AND answered.removed_at IS NULL)`,
    )
    .bind(target.undoneEventId, ...access.bindings);
}

// ---------------------------------------------------------------------------------------------
// Progress and the two quality-control reads.

export interface TagCountRow {
  readonly review_tag_id: ReviewTagId;
  readonly review_tag_group_id: ReviewTagGroupId;
  readonly document_count: number;
}

// How many documents currently carry each tag. Grouped in SQL rather than counted per tag, so the
// read count is one whatever the panel looks like.
export function selectTagCountsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT review_tag_id, review_tag_group_id, COUNT(*) AS document_count ` +
        `FROM ${REVIEW_DOCUMENT_TAG_TABLE} ` +
        `WHERE ${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id = ? ` +
        `AND ${REVIEW_DOCUMENT_TAG_TABLE}.removed_at IS NULL ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TAG_TABLE}.review_set_id`)} ` +
        `GROUP BY review_tag_id, review_tag_group_id ` +
        `ORDER BY review_tag_group_id ASC, review_tag_id ASC LIMIT ?`,
    )
    .bind(reviewSetId, ...access.bindings, limit);
}

export async function readTagCounts(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): Promise<TagCountRow[]> {
  const { results } = await selectTagCountsStatement(
    database,
    reviewSetId,
    access,
    limit,
  ).all<TagCountRow>();
  return results;
}

// How many documents are coded in every `required_for_completion` group — the numerator of the
// progress figure, with `review_set.document_count` as the denominator the load path already
// maintains.
//
// A document counts as complete when the number of DISTINCT required groups it has a live answer in
// equals the number of required groups the review set has. Counting distinct groups rather than rows
// is what keeps a multi-choice required group from counting twice.
export function selectCompletionCountStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS completed_count FROM (` +
        `SELECT tagged.review_document_id FROM ${REVIEW_DOCUMENT_TAG_TABLE} AS tagged ` +
        `JOIN ${REVIEW_TAG_GROUP_TABLE} AS required ` +
        `ON required.id = tagged.review_tag_group_id AND required.required_for_completion = 1 ` +
        `WHERE tagged.review_set_id = ? AND tagged.removed_at IS NULL ` +
        `AND ${access.fragmentFor("tagged.review_set_id")} ` +
        `GROUP BY tagged.review_document_id ` +
        `HAVING COUNT(DISTINCT tagged.review_tag_group_id) = (` +
        `SELECT COUNT(*) FROM ${REVIEW_TAG_GROUP_TABLE} ` +
        `WHERE review_set_id = ? AND required_for_completion = 1))`,
    )
    .bind(reviewSetId, ...access.bindings, reviewSetId);
}

export async function readCompletionCount(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): Promise<number> {
  const { results } = await selectCompletionCountStatement(database, reviewSetId, access).all<{
    completed_count: number;
  }>();
  return results[0]?.completed_count ?? 0;
}

// The uncoded filter: documents with no live answer in at least one required group. Expressed as the
// complement in SQL rather than assembled in the Worker, so the page is a page.
export function selectUncodedDocumentIdsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${REVIEW_DOCUMENT_TABLE}.id AS id FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE ${REVIEW_DOCUMENT_TABLE}.review_set_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TABLE}.review_set_id`)} ` +
        `AND EXISTS (SELECT 1 FROM ${REVIEW_TAG_GROUP_TABLE} AS required ` +
        `WHERE required.review_set_id = ${REVIEW_DOCUMENT_TABLE}.review_set_id ` +
        `AND required.required_for_completion = 1 ` +
        `AND NOT EXISTS (SELECT 1 FROM ${REVIEW_DOCUMENT_TAG_TABLE} AS answer ` +
        `WHERE answer.review_document_id = ${REVIEW_DOCUMENT_TABLE}.id ` +
        `AND answer.review_tag_group_id = required.id AND answer.removed_at IS NULL)) ` +
        `ORDER BY ${REVIEW_DOCUMENT_TABLE}.sort_date ASC, ${REVIEW_DOCUMENT_TABLE}.id ASC LIMIT ?`,
    )
    .bind(reviewSetId, ...access.bindings, limit);
}

export async function readUncodedDocumentIds(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): Promise<ReviewDocumentId[]> {
  const { results } = await selectUncodedDocumentIdsStatement(
    database,
    reviewSetId,
    access,
    limit,
  ).all<{ id: ReviewDocumentId }>();
  return results.map((result) => result.id);
}

// THE FAMILY-CONFLICT READ — a document coded with a withholding semantic whose family also carries a
// document coded `responsive`, and the reverse. It is COMPUTED over the rows rather than stored,
// because a stored flag about two rows goes stale the moment either moves, and the moment it goes
// stale is the moment a privileged document rides a family into a production.
//
// Semantics drive it, never names: a firm that renamed "Privileged" changes nothing here.
export function selectFamilyConflictFamilyIdsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): SqlStatement {
  const codedWith = (alias: string, semantics: string) =>
    `EXISTS (SELECT 1 FROM ${REVIEW_DOCUMENT_TAG_TABLE} AS ${alias} ` +
    `JOIN ${REVIEW_TAG_TABLE} AS ${alias}_tag ON ${alias}_tag.id = ${alias}.review_tag_id ` +
    `WHERE ${alias}.review_document_id = relative.id AND ${alias}.removed_at IS NULL ` +
    `AND ${alias}_tag.semantic IN (${semantics}))`;
  return database
    .prepare(
      `SELECT DISTINCT ${REVIEW_DOCUMENT_TABLE}.family_id AS family_id ` +
        `FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE ${REVIEW_DOCUMENT_TABLE}.review_set_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_TABLE}.review_set_id`)} ` +
        `AND EXISTS (SELECT 1 FROM ${REVIEW_DOCUMENT_TABLE} AS relative ` +
        `WHERE relative.family_id = ${REVIEW_DOCUMENT_TABLE}.family_id ` +
        `AND ${codedWith("withheld", "'privileged', 'privileged-redact'")}) ` +
        `AND EXISTS (SELECT 1 FROM ${REVIEW_DOCUMENT_TABLE} AS relative ` +
        `WHERE relative.family_id = ${REVIEW_DOCUMENT_TABLE}.family_id ` +
        `AND ${codedWith("produced", "'responsive'")}) ` +
        `ORDER BY family_id ASC LIMIT ?`,
    )
    .bind(reviewSetId, ...access.bindings, limit);
}

export async function readFamilyConflictFamilyIds(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
): Promise<ReviewDocumentId[]> {
  const { results } = await selectFamilyConflictFamilyIdsStatement(
    database,
    reviewSetId,
    access,
    limit,
  ).all<{ family_id: ReviewDocumentId }>();
  return results.map((result) => result.family_id);
}

// ---------------------------------------------------------------------------------------------
// THE REGISTRY the visibility fitness pass enumerates. Every builder above that touches review-set
// content appears here exactly once, with a sample invocation the test can inspect. A builder that is
// added and not registered is caught by the test's own not-vacuous count, which is pinned to this
// list's length — so the list cannot quietly fall behind the file.

export interface AccessScopedBuilder {
  readonly key: string;
  // Whether the statement is expected to carry a LIMIT. The single-row lookups and the writes do not
  // page, so "before the LIMIT" is vacuous for them; the test asserts placement in the WHERE clause
  // for every builder and the LIMIT ordering only for the ones that declare they page.
  readonly pages: boolean;
  readonly build: (database: SqlDatabase, access: ReviewSetAccessPredicate) => SqlStatement;
}

const SAMPLE_REVIEW_SET = "reviewSet_000000000000000000000" as ReviewSetId;
const SAMPLE_DOCUMENT = "reviewDocument_00000000000000000000" as ReviewDocumentId;
const SAMPLE_TAG = "reviewTag_0000000000000000000000" as ReviewTagId;
const SAMPLE_TAG_GROUP = "reviewTagGroup_00000000000000000000" as ReviewTagGroupId;
const SAMPLE_EVENT = "reviewTagEvent_00000000000000000000" as ReviewTagEventId;
const SAMPLE_ROW = "reviewDocumentTag_0000000000000000000" as ReviewDocumentTagId;
const SAMPLE_INSTANT = "2026-08-08T00:00:00.000Z";

export const ACCESS_SCOPED_BUILDERS: readonly AccessScopedBuilder[] = [
  {
    key: "selectTagGroups",
    pages: true,
    build: (database, access) => selectTagGroupsStatement(database, SAMPLE_REVIEW_SET, access, 50),
  },
  {
    key: "selectTags",
    pages: true,
    build: (database, access) => selectTagsStatement(database, SAMPLE_REVIEW_SET, access, 50),
  },
  {
    key: "selectTag",
    pages: true,
    build: (database, access) => selectTagStatement(database, SAMPLE_TAG, access),
  },
  {
    key: "selectTagGroup",
    pages: true,
    build: (database, access) => selectTagGroupStatement(database, SAMPLE_TAG_GROUP, access),
  },
  {
    key: "selectTagEvent",
    pages: true,
    build: (database, access) => selectTagEventStatement(database, SAMPLE_EVENT, access),
  },
  {
    key: "selectTagEventPage",
    pages: true,
    build: (database, access) =>
      selectTagEventPageStatement(database, SAMPLE_REVIEW_SET, access, 50),
  },
  {
    key: "applyDocumentTag",
    pages: false,
    build: (database, access) =>
      applyDocumentTagStatement(
        database,
        {
          id: SAMPLE_ROW,
          reviewSetId: SAMPLE_REVIEW_SET,
          reviewDocumentId: SAMPLE_DOCUMENT,
          reviewTagId: SAMPLE_TAG,
          reviewTagGroupId: SAMPLE_TAG_GROUP,
          singleChoice: true,
          appliedByEventId: SAMPLE_EVENT,
          now: SAMPLE_INSTANT,
        },
        access,
      ),
  },
  {
    key: "removeDocumentTag",
    pages: false,
    build: (database, access) =>
      removeDocumentTagStatement(
        database,
        {
          reviewSetId: SAMPLE_REVIEW_SET,
          reviewDocumentId: SAMPLE_DOCUMENT,
          reviewTagId: SAMPLE_TAG,
          removedByEventId: SAMPLE_EVENT,
          now: SAMPLE_INSTANT,
        },
        access,
      ),
  },
  {
    key: "clearSingleChoiceGroup",
    pages: false,
    build: (database, access) =>
      clearSingleChoiceGroupStatement(
        database,
        {
          reviewSetId: SAMPLE_REVIEW_SET,
          reviewDocumentId: SAMPLE_DOCUMENT,
          reviewTagGroupId: SAMPLE_TAG_GROUP,
          removedByEventId: SAMPLE_EVENT,
          now: SAMPLE_INSTANT,
        },
        access,
      ),
  },
  {
    key: "selectDocumentCoding",
    pages: true,
    build: (database, access) =>
      selectDocumentCodingStatement(database, SAMPLE_DOCUMENT, access, 50),
  },
  {
    key: "selectDocumentCodingHistory",
    pages: true,
    build: (database, access) =>
      selectDocumentCodingHistoryStatement(database, SAMPLE_DOCUMENT, access, 50),
  },
  {
    key: "selectFamilyDocumentIds",
    pages: true,
    build: (database, access) =>
      selectFamilyDocumentIdsStatement(database, SAMPLE_REVIEW_SET, SAMPLE_DOCUMENT, access, 50),
  },
  {
    key: "selectReachableDocumentIds",
    pages: true,
    build: (database, access) =>
      selectReachableDocumentIdsStatement(
        database,
        SAMPLE_REVIEW_SET,
        [SAMPLE_DOCUMENT],
        access,
        50,
      ),
  },
  {
    key: "undoAppliedRows",
    pages: false,
    build: (database, access) =>
      undoAppliedRowsStatement(
        database,
        { undoneEventId: SAMPLE_EVENT, undoEventId: SAMPLE_EVENT, now: SAMPLE_INSTANT },
        access,
      ),
  },
  {
    key: "undoRemovedRows",
    pages: false,
    build: (database, access) =>
      undoRemovedRowsStatement(database, { undoneEventId: SAMPLE_EVENT }, access),
  },
  {
    key: "selectTagCounts",
    pages: true,
    build: (database, access) => selectTagCountsStatement(database, SAMPLE_REVIEW_SET, access, 50),
  },
  {
    key: "selectCompletionCount",
    pages: false,
    build: (database, access) =>
      selectCompletionCountStatement(database, SAMPLE_REVIEW_SET, access),
  },
  {
    key: "selectUncodedDocumentIds",
    pages: true,
    build: (database, access) =>
      selectUncodedDocumentIdsStatement(database, SAMPLE_REVIEW_SET, access, 50),
  },
  {
    key: "selectFamilyConflictFamilyIds",
    pages: true,
    build: (database, access) =>
      selectFamilyConflictFamilyIdsStatement(database, SAMPLE_REVIEW_SET, access, 50),
  },
];

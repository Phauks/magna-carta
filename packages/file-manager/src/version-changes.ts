import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { MEMBER_TABLE } from "@magna-carta/data-access/member-statements";
import type { FileId, FileVersionId, UserId } from "@magna-carta/identifiers/types";
import { FILE_VERSION_TABLE } from "./file-statements.ts";

// A version's tracked changes, as history reads them: who wrote or removed which words, and where.
//
// The rows are read from the document when a version's export copy is made (the document is in
// hand then, off the request path), one row per mark the version carries that no earlier version
// of the file carried. A stored document keeps every mark for as long as it lives, so a version's
// full set is the whole history so far; what a version is FOR in history is what changed in it,
// which is the set difference against everything recorded before it. The identity of a mark is
// what the document holds — its kind, its author, its instant, its words — since the revision
// identifiers the editor writes are renumbered on every save and identify nothing across versions.

export const FILE_VERSION_CHANGE_TABLE = "file_version_change";

export type VersionChangeKind = "insertion" | "deletion" | "formatting";

/** The longest run of words a row keeps. A row is a record of a change, not a copy of the document. */
export const MAX_CHANGE_TEXT_CHARACTERS = 2000;

/** The most rows one version records: past this, the rest of a very heavily marked document is not kept. */
export const MAX_CHANGES_PER_VERSION = 5000;

export interface VersionChangeRow {
  readonly sequence: number;
  readonly kind: VersionChangeKind;
  readonly authorName: string;
  readonly authorUserId: UserId | null;
  readonly changedAt: string | null;
  readonly text: string;
  readonly textTruncated: boolean;
  readonly part: string;
  readonly paragraphIndex: number;
}

/** A mark as the reader hands it over, before it is attributed and recorded. */
export interface ReadMark {
  readonly kind: VersionChangeKind;
  readonly author: string;
  readonly changedAt: string | null;
  readonly text: string;
  readonly part: string;
  readonly paragraphIndex: number;
}

/** The identity of a mark across versions: what the document holds, never the editor's numbering. */
export function markKey(mark: {
  readonly kind: VersionChangeKind;
  readonly authorName: string;
  readonly changedAt: string | null;
  readonly text: string;
  readonly part: string;
}): string {
  return [mark.kind, mark.authorName, mark.changedAt ?? "", mark.part, mark.text].join("\u001F");
}

// The marks a version carries that no earlier version recorded, in document order, capped. The
// keys of every earlier row are the memory; a mark whose key was seen is the same mark still there.
export function newMarksSince(
  marks: readonly ReadMark[],
  recordedKeys: ReadonlySet<string>,
): readonly ReadMark[] {
  const fresh: ReadMark[] = [];
  for (const mark of marks) {
    const key = markKey({ ...mark, authorName: mark.author });
    if (recordedKeys.has(key)) continue;
    fresh.push(mark);
    if (fresh.length >= MAX_CHANGES_PER_VERSION) break;
  }
  return fresh;
}

export function versionChangeRows(
  marks: readonly ReadMark[],
  resolveAuthor: (name: string) => UserId | null,
): VersionChangeRow[] {
  return marks.map((mark, sequence) => ({
    sequence,
    kind: mark.kind,
    authorName: mark.author,
    authorUserId: resolveAuthor(mark.author),
    changedAt: mark.changedAt,
    text: mark.text.slice(0, MAX_CHANGE_TEXT_CHARACTERS),
    textTruncated: mark.text.length > MAX_CHANGE_TEXT_CHARACTERS,
    part: mark.part,
    paragraphIndex: mark.paragraphIndex,
  }));
}

/** Replaces a version's rows: the recording is idempotent, so a second pass writes the same set. */
export function replaceVersionChangesStatements(
  database: SqlDatabase,
  versionId: FileVersionId,
  rows: readonly VersionChangeRow[],
): SqlStatement[] {
  return [
    database
      .prepare(`DELETE FROM ${FILE_VERSION_CHANGE_TABLE} WHERE version_id = ?1`)
      .bind(versionId),
    ...rows.map((row) =>
      database
        .prepare(
          `INSERT INTO ${FILE_VERSION_CHANGE_TABLE} (version_id, sequence, kind, author_name, author_user_id, changed_at, text, text_truncated, part, paragraph_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        )
        .bind(
          versionId,
          row.sequence,
          row.kind,
          row.authorName,
          row.authorUserId,
          row.changedAt,
          row.text,
          row.textTruncated ? 1 : 0,
          row.part,
          row.paragraphIndex,
        ),
    ),
  ];
}

// The keys of every mark recorded on an earlier clean version of the file: the memory the set
// difference is taken against. Bounded by the file's own history; a document edited for years
// with every mark kept is the case the per-version cap above holds down.
export async function readRecordedMarkKeys(
  database: SqlDatabase,
  fileId: FileId,
  beforeVersionNumber: number,
): Promise<Set<string>> {
  const { results } = await database
    .prepare(
      `SELECT c.kind, c.author_name, c.changed_at, c.text, c.part FROM ${FILE_VERSION_CHANGE_TABLE} c ` +
        `JOIN ${FILE_VERSION_TABLE} v ON v.id = c.version_id ` +
        `WHERE v.file_id = ?1 AND v.version_number < ?2 AND v.status = 'clean'`,
    )
    .bind(fileId, beforeVersionNumber)
    .all<{
      kind: VersionChangeKind;
      author_name: string;
      changed_at: string | null;
      text: string;
      part: string;
    }>();
  return new Set(
    results.map((row) =>
      markKey({
        kind: row.kind,
        authorName: row.author_name,
        changedAt: row.changed_at,
        text: row.text,
        part: row.part,
      }),
    ),
  );
}

export interface VersionChange extends VersionChangeRow {
  /** The author's current display name where the resolution holds; null for a departed member. */
  readonly authorCurrentName: string | null;
}

/** One version's changes in document order, the author's current name read at query time. */
export async function listVersionChanges(
  database: SqlDatabase,
  versionId: FileVersionId,
): Promise<readonly VersionChange[]> {
  const { results } = await database
    .prepare(
      `SELECT c.sequence, c.kind, c.author_name, c.author_user_id, c.changed_at, c.text, c.text_truncated, c.part, c.paragraph_index, m.display_name AS author_current_name ` +
        `FROM ${FILE_VERSION_CHANGE_TABLE} c LEFT JOIN ${MEMBER_TABLE} m ON m.user_id = c.author_user_id ` +
        // The version's own status gates the version read that precedes this; the rows are the
        // version's. fitness:allow-no-status
        `WHERE c.version_id = ?1 ORDER BY c.sequence ASC`,
    )
    .bind(versionId)
    .all<{
      sequence: number;
      kind: VersionChangeKind;
      author_name: string;
      author_user_id: UserId | null;
      changed_at: string | null;
      text: string;
      text_truncated: number;
      part: string;
      paragraph_index: number;
      author_current_name: string | null;
    }>();
  return results.map((row) => ({
    sequence: row.sequence,
    kind: row.kind,
    authorName: row.author_name,
    authorUserId: row.author_user_id,
    changedAt: row.changed_at,
    text: row.text,
    textTruncated: row.text_truncated === 1,
    part: row.part,
    paragraphIndex: row.paragraph_index,
    authorCurrentName: row.author_current_name,
  }));
}

/** How many changes of each kind one author made in a version: the history's summary line. */
export interface VersionChangeSummary {
  readonly versionId: FileVersionId;
  readonly authorUserId: UserId | null;
  readonly authorName: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly formatting: number;
}

export async function summarizeVersionChanges(
  database: SqlDatabase,
  versionIds: readonly FileVersionId[],
): Promise<readonly VersionChangeSummary[]> {
  if (versionIds.length === 0) return [];
  const placeholders = versionIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT c.version_id, c.author_user_id, ` +
        // The current display name where the member is still here, else the name the document holds.
        `COALESCE(m.display_name, c.author_name) AS author_name, ` +
        `SUM(CASE WHEN c.kind = 'insertion' THEN 1 ELSE 0 END) AS insertions, ` +
        `SUM(CASE WHEN c.kind = 'deletion' THEN 1 ELSE 0 END) AS deletions, ` +
        `SUM(CASE WHEN c.kind = 'formatting' THEN 1 ELSE 0 END) AS formatting ` +
        `FROM ${FILE_VERSION_CHANGE_TABLE} c LEFT JOIN ${MEMBER_TABLE} m ON m.user_id = c.author_user_id ` +
        // The rows belong to versions the caller already read through the status gate. fitness:allow-no-status
        `WHERE c.version_id IN (${placeholders}) ` +
        `GROUP BY c.version_id, c.author_user_id, COALESCE(m.display_name, c.author_name) ` +
        `ORDER BY c.version_id, MIN(c.sequence)`,
    )
    .bind(...versionIds)
    .all<{
      version_id: FileVersionId;
      author_user_id: UserId | null;
      author_name: string;
      insertions: number;
      deletions: number;
      formatting: number;
    }>();
  return results.map((row) => ({
    versionId: row.version_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    insertions: row.insertions,
    deletions: row.deletions,
    formatting: row.formatting,
  }));
}

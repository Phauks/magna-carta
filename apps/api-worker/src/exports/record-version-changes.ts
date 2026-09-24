import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  MEMBER_TABLE,
  selectFirmMembersStatement,
} from "@magna-carta/data-access/member-statements";
import { readTrackedChanges } from "@magna-carta/document-assembly/ooxml-read-tracked-changes";
import { FILE_VERSION_PARTICIPANT_TABLE } from "@magna-carta/file-manager/file-statements";
import {
  newMarksSince,
  readRecordedMarkKeys,
  replaceVersionChangesStatements,
  versionChangeRows,
} from "@magna-carta/file-manager/version-changes";
import type { FileId, FileVersionId, UserId } from "@magna-carta/identifiers/types";

// Reading a version's marks into history, at the one moment the document is in hand off the
// request path: when its export copy is made. One row per mark the version carries that no
// earlier version of the file did, each attributed to a member.
//
// A MARK CARRIES A NAME, NOT A MEMBER. The document holds the author as text (the display name
// the host handed the editor on CheckFileInfo), so the name is resolved to a member here, at the
// moment of the cut: the session's participants first — two members sharing a display name are
// told apart by who was in the document — and the firm's roster second. The row then carries the
// member's identifier, so a later rename follows them in history, and it keeps the name the
// document holds beside it, so a mark whose name resolves to nobody is kept rather than dropped.

export interface VersionChangesRecording {
  readonly statements: readonly SqlStatement[];
  readonly recorded: number;
}

// The members who were in the document when the version was cut, by their current display name.
async function participantNames(
  database: SqlDatabase,
  versionId: FileVersionId,
): Promise<ReadonlyMap<string, UserId>> {
  const { results } = await database
    .prepare(
      `SELECT p.member_user_id, m.display_name FROM ${FILE_VERSION_PARTICIPANT_TABLE} p ` +
        `LEFT JOIN ${MEMBER_TABLE} m ON m.user_id = p.member_user_id WHERE p.version_id = ?1`,
    )
    .bind(versionId)
    .all<{ member_user_id: UserId; display_name: string | null }>();
  return uniqueByName(
    results.map((row) => ({ userId: row.member_user_id, name: row.display_name })),
  );
}

async function rosterNames(database: SqlDatabase): Promise<ReadonlyMap<string, UserId>> {
  const { results } = await selectFirmMembersStatement(database).all<{
    userId: UserId;
    displayName: string | null;
  }>();
  return uniqueByName(results.map((row) => ({ userId: row.userId, name: row.displayName })));
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

// A name that two members share resolves to neither: naming the wrong person is worse than naming
// nobody, and the roster is the second look, not the last word.
function uniqueByName(
  members: readonly { readonly userId: UserId; readonly name: string | null }[],
): ReadonlyMap<string, UserId> {
  const seen = new Map<string, UserId | null>();
  for (const member of members) {
    if (member.name === null || member.name.trim() === "") continue;
    const key = nameKey(member.name);
    seen.set(key, seen.has(key) ? null : member.userId);
  }
  const unique = new Map<string, UserId>();
  for (const [key, userId] of seen) if (userId !== null) unique.set(key, userId);
  return unique;
}

/**
 * The statements that record the version's new marks, ready to ride the batch that records its
 * export copy. Reads the file's earlier rows and the names it needs; writes nothing itself.
 */
export async function recordVersionChanges(
  database: SqlDatabase,
  version: { readonly id: FileVersionId; readonly fileId: FileId; readonly versionNumber: number },
  bytes: Uint8Array,
): Promise<VersionChangesRecording> {
  const read = readTrackedChanges(bytes);
  // A document the reader cannot hold records no marks; the export copy's own outcome says why.
  if (!read.ok) return { statements: [], recorded: 0 };
  const recordedKeys = await readRecordedMarkKeys(database, version.fileId, version.versionNumber);
  const fresh = newMarksSince(read.value.changes, recordedKeys);
  if (fresh.length === 0) {
    return { statements: replaceVersionChangesStatements(database, version.id, []), recorded: 0 };
  }

  const participants = await participantNames(database, version.id);
  // The roster is read only when a name the participants do not answer is met.
  const unanswered = fresh.some((mark) => !participants.has(nameKey(mark.author)));
  const roster = unanswered ? await rosterNames(database) : new Map<string, UserId>();
  const resolveAuthor = (name: string): UserId | null =>
    participants.get(nameKey(name)) ?? roster.get(nameKey(name)) ?? null;
  const rows = versionChangeRows(fresh, resolveAuthor);
  return {
    statements: replaceVersionChangesStatements(database, version.id, rows),
    recorded: rows.length,
  };
}

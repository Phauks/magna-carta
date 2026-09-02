import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { TimeEntryId } from "@magna-carta/identifiers/types";
import { isFrozen, type TimeEntryStatus } from "./lifecycle.ts";
import { TIME_ENTRY_TABLE } from "./time-entry-statements.ts";
import { TimeEntryValidationError } from "./time-entry-validation.ts";
import type { TimekeepingServiceOptions } from "./time-entry-service.ts";

// A time entry's attachments are REFERENCES to files already in the entry's matter — the research
// memo behind an hour of drafting, the order the hearing produced. Attaching never copies bytes and
// detaching never deletes: the link row goes, the file stays in the matter, and the audit trail
// keeps both acts. The attach path refuses a file on another matter (or a soft-deleted one), so an
// entry can never point outside its own matter's record. Both acts follow the costs receipt
// discipline: pre-read, refuse a frozen entry, compose the write + audit into one EffectWrite.

export const TIME_ENTRY_ATTACHMENT_TABLE = "time_entry_attachment";

export interface TimeEntryAttachmentItem {
  readonly fileId: string;
  readonly fileName: string | null; // null when the file row is gone — an honest gap, never a guess
  readonly createdAt: string;
  readonly createdByUserId: string | null;
  readonly createdByName: string | null;
}

// The entry's attachments, oldest link first. File names resolve at read time (a rename shows the
// current name); the attacher's name resolves through the member mirror and is null for a departed
// member or a system write.
export async function listTimeEntryAttachments(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
): Promise<TimeEntryAttachmentItem[]> {
  const { results } = await database
    .prepare(
      `SELECT a.file_id, f.name AS file_name, a.created_at, a.created_by, m.display_name AS created_by_name
         FROM ${TIME_ENTRY_ATTACHMENT_TABLE} a
         LEFT JOIN file f ON f.id = a.file_id
         LEFT JOIN member m ON m.user_id = a.created_by
        WHERE a.time_entry_id = ?1
        ORDER BY a.created_at ASC, a.file_id ASC`,
    )
    .bind(timeEntryId)
    .all<{
      file_id: string;
      file_name: string | null;
      created_at: string;
      created_by: string | null;
      created_by_name: string | null;
    }>();
  return results.map((row) => ({
    fileId: row.file_id,
    fileName: row.file_name,
    createdAt: row.created_at,
    createdByUserId: row.created_by,
    createdByName: row.created_by_name,
  }));
}

async function loadEntryForAttachment(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
): Promise<{ status: TimeEntryStatus; matterId: string }> {
  const { results } = await database
    .prepare(`SELECT status, matter_id FROM ${TIME_ENTRY_TABLE} WHERE id = ?1`)
    .bind(timeEntryId)
    .all<{ status: TimeEntryStatus; matter_id: string }>();
  const row = results[0];
  if (row === undefined) {
    throw new TimeEntryValidationError("not-found", `no such time entry: ${timeEntryId}`);
  }
  return { status: row.status, matterId: row.matter_id };
}

// Links one of the matter's live files to the entry. Refuses a frozen entry, a file that is not on
// the entry's matter (or is soft-deleted — a deleted file reads as absent here exactly as it does
// everywhere else), and a duplicate link. The pre-reads precede any effect composition, so an
// unknown id can never produce a phantom audit row; the primary key on (time_entry_id, file_id) is
// the concurrency backstop behind the duplicate pre-read.
export async function attachFileToTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  fileId: string,
  options: TimekeepingServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const entry = await loadEntryForAttachment(database, timeEntryId);
  if (isFrozen(entry.status)) {
    throw new TimeEntryValidationError(
      "frozen-entry",
      `time entry ${timeEntryId} is ${entry.status} and frozen`,
    );
  }

  const { results: fileRows } = await database
    .prepare("SELECT matter_id, deleted_at FROM file WHERE id = ?1")
    .bind(fileId)
    .all<{ matter_id: string; deleted_at: string | null }>();
  const fileRow = fileRows[0];
  if (
    fileRow === undefined ||
    fileRow.deleted_at !== null ||
    fileRow.matter_id !== entry.matterId
  ) {
    throw new TimeEntryValidationError(
      "file-not-on-matter",
      "an attachment references one of the entry's matter's own documents; this file is not one of them",
    );
  }

  const { results: existing } = await database
    .prepare(
      `SELECT 1 AS present FROM ${TIME_ENTRY_ATTACHMENT_TABLE} WHERE time_entry_id = ?1 AND file_id = ?2`,
    )
    .bind(timeEntryId, fileId)
    .all<{ present: number }>();
  if (existing[0] !== undefined) {
    throw new TimeEntryValidationError(
      "already-attached",
      "this file is already attached to the entry",
    );
  }

  const createdAt = options.clock.now();
  return {
    effect: {
      statements: [
        database
          .prepare(
            `INSERT INTO ${TIME_ENTRY_ATTACHMENT_TABLE} (time_entry_id, file_id, created_at, created_by) VALUES (?1, ?2, ?3, ?4)`,
          )
          .bind(timeEntryId, fileId, createdAt, options.actorUserId),
        domainAuditStatement(database, {
          event: "time_entry.file_attached",
          subjectId: timeEntryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { fileId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Removes the link — never the file. Same pre-read-then-compose discipline as attach; a missing
// link is a named refusal rather than a silent zero-row DELETE.
export async function detachFileFromTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  fileId: string,
  options: TimekeepingServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const entry = await loadEntryForAttachment(database, timeEntryId);
  if (isFrozen(entry.status)) {
    throw new TimeEntryValidationError(
      "frozen-entry",
      `time entry ${timeEntryId} is ${entry.status} and frozen`,
    );
  }

  const { results: existing } = await database
    .prepare(
      `SELECT 1 AS present FROM ${TIME_ENTRY_ATTACHMENT_TABLE} WHERE time_entry_id = ?1 AND file_id = ?2`,
    )
    .bind(timeEntryId, fileId)
    .all<{ present: number }>();
  if (existing[0] === undefined) {
    throw new TimeEntryValidationError("not-attached", "this file is not attached to the entry");
  }

  return {
    effect: {
      statements: [
        database
          .prepare(
            `DELETE FROM ${TIME_ENTRY_ATTACHMENT_TABLE} WHERE time_entry_id = ?1 AND file_id = ?2`,
          )
          .bind(timeEntryId, fileId),
        domainAuditStatement(database, {
          event: "time_entry.file_detached",
          subjectId: timeEntryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { fileId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

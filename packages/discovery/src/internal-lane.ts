import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  EmailMessageId,
  FileId,
  FileVersionId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { MAX_SELECTION_SIZE } from "./limits.ts";
import { DiscoveryValidationError } from "./validation.ts";

// The internal lanes: a SELECTION, not an upload. The firm already holds the bytes, the hash, and the
// scan verdict, so a load is a metadata operation and no byte moves.
//
// The one rule that matters here: LOADING IS A SNAPSHOT OF A VERSION, NOT A SUBSCRIPTION TO A FILE.
// The resolved version is pinned onto the review document. If the underlying file gains a new version
// afterwards the review set does not change, because the corpus under review is what was reviewed; a
// newer version enters only through a new load, which is a recorded act with its own manifest.

export interface ResolvedFileVersion {
  readonly fileId: FileId;
  readonly fileVersionId: FileVersionId;
  readonly matterId: MatterId;
  readonly name: string;
  readonly sizeBytes: number | null;
  readonly contentSha256: string | null;
  readonly status: string;
}

// The current version of each selected file, with everything the allocation needs. Resolved as ONE
// indexed read over the selection rather than a read per file — the N+1 a selection of five thousand
// files would otherwise be.
//
// THE ORDER BY IS LOAD-BEARING, not tidiness. The load coordinator's cursor is an INDEX into the
// plan this read produces, and it survives an eviction while the plan does not: a resumed turn
// re-derives the plan and skips past the cursor. If two runs of this query could return the same
// rows in a different order, the cursor would point at a different document on the second turn — and
// the document it skipped would be missing from the corpus with nobody able to tell, which is the
// exact failure discovery cannot have. `file.id` is the primary key, so this total order is stable
// for a given selection no matter what the query planner does.
export function selectCurrentVersionsForFilesStatement(
  database: SqlDatabase,
  fileIds: readonly FileId[],
): SqlStatement {
  const placeholders = fileIds.map((_, position) => `?${position + 1}`).join(", ");
  return database
    .prepare(
      `SELECT file.id AS fileId, file.matter_id AS matterId, file.name AS name, ` +
        `file_version.id AS fileVersionId, file_version.size_bytes AS sizeBytes, ` +
        `file_version.content_sha256 AS contentSha256, file_version.status AS status ` +
        `FROM file JOIN file_version ON file_version.id = file.current_version_id ` +
        `WHERE file.id IN (${placeholders}) AND file.deleted_at IS NULL ` +
        `ORDER BY file.id ASC`,
    )
    .bind(...fileIds);
}

export async function resolveFileSelection(
  database: SqlDatabase,
  fileIds: readonly FileId[],
): Promise<ResolvedFileVersion[]> {
  assertSelectionSize(fileIds.length);
  const { results } = await selectCurrentVersionsForFilesStatement(
    database,
    fileIds,
  ).all<ResolvedFileVersion>();
  return results;
}

export function assertSelectionSize(size: number): void {
  if (size === 0) {
    throw new DiscoveryValidationError(
      "discovery-selection-empty",
      "a load names at least one thing to load",
    );
  }
  if (size > MAX_SELECTION_SIZE) {
    throw new DiscoveryValidationError(
      "discovery-selection-too-large",
      `a selection names at most ${MAX_SELECTION_SIZE} items; this one names ${size}. Load it as ` +
        `several loads — each is its own recorded act with its own manifest, which is a better ` +
        `record than one load nobody can describe the boundaries of.`,
    );
  }
}

// A QUARANTINED VERSION IS NOT REVIEW MATERIAL, and neither is one still pending its scan. Refused by
// name rather than skipped: a firm that selected fifty files and got forty-eight review documents
// with no explanation has a corpus it cannot certify.
export function assertVersionsAreClean(versions: readonly ResolvedFileVersion[]): void {
  const unclean = versions.filter((version) => version.status !== "clean");
  if (unclean.length === 0) return;
  throw new DiscoveryValidationError(
    "discovery-version-not-clean",
    `${unclean.length} of the selected files is not a clean version and cannot enter a review set: ` +
      unclean.map((version) => `${version.fileId} (${version.status})`).join(", ") +
      `. A quarantined file is evidence and stays where it is; it does not become review material ` +
      `by being selected.`,
  );
}

// Everything selected must belong to the matter the review set is on. A load that reached across
// matters would put another case's documents in a corpus a firm is about to certify the contents of.
export function assertSelectionMatchesMatter(
  versions: readonly ResolvedFileVersion[],
  matterId: MatterId,
): void {
  const foreign = versions.filter((version) => version.matterId !== matterId);
  if (foreign.length === 0) return;
  throw new DiscoveryValidationError(
    "discovery-selection-matter-mismatch",
    `${foreign.length} of the selected files belongs to a different matter. A review set is one ` +
      `matter's corpus.`,
  );
}

// ---------------------------------------------------------------------------------------------
// The email lane
//
// A message and its attachments enter as a FAMILY. They come free: email_attachment already ties the
// file rows to the message, so nothing has to be re-parsed and no byte is re-read.

export interface ResolvedEmailMessage {
  readonly emailMessageId: EmailMessageId;
  readonly subject: string | null;
  readonly sentAt: string | null;
  readonly receivedAt: string;
  readonly contentSha256: string;
  readonly dedupKey: string;
}

export interface ResolvedEmailAttachment {
  readonly emailMessageId: EmailMessageId;
  readonly fileId: FileId;
  readonly fileVersionId: FileVersionId;
  readonly filename: string | null;
  readonly sizeBytes: number | null;
  readonly contentSha256: string | null;
  readonly status: string;
}

// The messages FILED ON THIS MATTER, resolved through the existing link table. A message not filed to
// the matter is not the matter's correspondence, and a load that reached one would be a load reaching
// outside the corpus it declared.
export function selectFiledMessagesStatement(
  database: SqlDatabase,
  matterId: MatterId,
  emailMessageIds: readonly EmailMessageId[],
): SqlStatement {
  const placeholders = emailMessageIds.map((_, position) => `?${position + 2}`).join(", ");
  return database
    .prepare(
      `SELECT email_message.id AS emailMessageId, email_message.subject AS subject, ` +
        `email_message.sent_at AS sentAt, email_message.received_at AS receivedAt, ` +
        `email_message.content_sha256 AS contentSha256, email_message.dedup_key AS dedupKey ` +
        `FROM email_message ` +
        `JOIN email_matter_link ON email_matter_link.email_message_id = email_message.id ` +
        `WHERE email_matter_link.matter_id = ?1 AND email_matter_link.state = 'filed' ` +
        `AND email_message.id IN (${placeholders}) ` +
        // Load-bearing, for the reason spelled out on the file selection above: the coordinator's
        // cursor is an index into the plan derived from this read, and an unstable order would let a
        // resumed turn skip a message. The email lane has no unique index to catch it either, so an
        // unstable order here could duplicate a family as well as lose one.
        `ORDER BY email_message.id ASC`,
    )
    .bind(matterId, ...emailMessageIds);
}

export async function resolveEmailSelection(
  database: SqlDatabase,
  matterId: MatterId,
  emailMessageIds: readonly EmailMessageId[],
): Promise<ResolvedEmailMessage[]> {
  assertSelectionSize(emailMessageIds.length);
  const { results } = await selectFiledMessagesStatement(
    database,
    matterId,
    emailMessageIds,
  ).all<ResolvedEmailMessage>();
  return results;
}

// The extracted attachments of the selected messages, with the version each one committed as. An
// attachment recorded as filtered-inline or oversize carries no file, so it produces no review
// document — the message's own sidecar is where its absence is described, at processing time.
export function selectAttachmentsForMessagesStatement(
  database: SqlDatabase,
  emailMessageIds: readonly EmailMessageId[],
): SqlStatement {
  const placeholders = emailMessageIds.map((_, position) => `?${position + 1}`).join(", ");
  return database
    .prepare(
      `SELECT email_attachment.email_message_id AS emailMessageId, ` +
        `email_attachment.file_id AS fileId, email_attachment.filename AS filename, ` +
        `file_version.id AS fileVersionId, file_version.size_bytes AS sizeBytes, ` +
        `file_version.content_sha256 AS contentSha256, file_version.status AS status ` +
        `FROM email_attachment ` +
        `JOIN file ON file.id = email_attachment.file_id ` +
        `JOIN file_version ON file_version.id = file.current_version_id ` +
        `WHERE email_attachment.email_message_id IN (${placeholders}) ` +
        `AND email_attachment.outcome = 'extracted' AND email_attachment.file_id IS NOT NULL ` +
        `ORDER BY email_attachment.email_message_id ASC, email_attachment.created_at ASC, email_attachment.id ASC`,
    )
    .bind(...emailMessageIds);
}

export async function resolveEmailAttachments(
  database: SqlDatabase,
  emailMessageIds: readonly EmailMessageId[],
): Promise<ResolvedEmailAttachment[]> {
  if (emailMessageIds.length === 0) return [];
  const { results } = await selectAttachmentsForMessagesStatement(
    database,
    emailMessageIds,
  ).all<ResolvedEmailAttachment>();
  return results;
}

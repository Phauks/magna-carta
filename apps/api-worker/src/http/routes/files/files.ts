import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { EffectStatement } from "@magna-carta/data-access/effect-batch";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  assignDocumentType,
  completeUploadSession,
  initiateUpload,
  moveFile,
  renameFile,
  restoreFile,
  softDeleteFile,
} from "@magna-carta/file-manager/file-service";
import { fileAuditStatement } from "@magna-carta/file-manager/audit";
import { selectFileStatement } from "@magna-carta/file-manager/file-statements";
import {
  listVersionChanges,
  summarizeVersionChanges,
} from "@magna-carta/file-manager/version-changes";
import {
  getCurrentCleanVersion,
  getFileSummary,
  getFileWithArchiveVersion,
  getFileWithNamedVersion,
  listCleanVersions,
  listDeletedFiles,
  listDocumentTypeNamesByIds,
  listFileHistory,
  listFiles,
  listFoldersByMatter,
  type FileListItem,
} from "@magna-carta/file-manager/queries";
import {
  anyEntryReferencesAFolder,
  collectReferencedDocumentTypeIds,
  folderTextResolver,
  resolveHistoryChangeTexts,
} from "@magna-carta/file-manager/history-change-text";
import {
  readZipCentralDirectory,
  ZipCentralDirectoryError,
  type ArchiveSourceBucket,
} from "@magna-carta/file-manager/zip-central-directory";
import { readArchiveCaps } from "@magna-carta/file-manager/upload-policy";
import {
  archiveFormatName,
  archiveFormatOf,
  ARCHIVE_SNIFF_BYTES,
} from "@magna-carta/file-manager/archive-format";
import {
  archiveExtractability,
  ArchiveExtraction,
  readArchiveContents,
  SevenZipEngineUnavailableError,
  type ArchiveEngines,
  type ArchiveExtractionRefusal,
} from "@magna-carta/file-manager/archive-members";
import { SevenZipListingError } from "@magna-carta/seven-zip";
import { sevenZipEngine } from "../../../files/seven-zip-engine.ts";
import { decidePreview } from "@magna-carta/file-manager/preview-policy";
import {
  readFlaggedTreatment,
  readStepUpReauthOnFlagged,
} from "@magna-carta/file-manager/scan-policy-settings";
import { documentSessionStub } from "../../../editing/document-session.ts";
import { mintPreviewDeliveryToken } from "../../../files/preview-token.ts";
import { readPreviewVersion } from "../../../files/inline-playable-assessment.ts";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import type {
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  UploadSessionId,
} from "@magna-carta/identifiers/types";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { runInBackground } from "../../deferred-work.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import type { ProblemTypeKey } from "../../contracts/problem-types.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { maybeEnqueueRescanOnAccess } from "../../../files/access-rescan.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { resolveExportObject } from "../../../exports/export-object.ts";
import { registerDownload } from "../../../downloads/download-register.ts";
import { enqueueDevIngestEvent } from "../../../files/presign.ts";
import { presignerForEnv } from "../../../files/presigner-wiring.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../../idempotency-conflict-problems.ts";

// File metadata + download. List/get are open to any authenticated firm member (reads, permission
// null); rename/move/document-type ride files:organize, soft-delete rides files:delete. Every read
// serves only clean, non-deleted content (the file-manager queries enforce the status gate).
// /download resolves the current clean version and 302s to a short-TTL presigned GET — the bytes flow
// client↔R2, never through the Worker — and writes an audit_log export row.

const FILES_ORGANIZE = "files:organize" as const;
const FILES_DELETE = "files:delete" as const;
const FILES_UPLOAD = "files:upload" as const;
// A short life for a download credential — long enough to start the GET, short enough that a leaked
// URL expires quickly.
const DOWNLOAD_TTL_SECONDS = 300;

const FileSummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    folderId: z.string().nullable(),
    name: z.string(),
    documentTypeId: z.string().nullable(),
    // The clean current version, or null. Written only by a clean commit, so a pending or quarantined
    // row carries null here and structurally cannot render a download link.
    currentVersionId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    // The display version's facts (the clean current version, or — in the opt-in status include — the
    // latest pending/quarantined version). One list call paints the table without a per-row fan-out to
    // the version history. sizeBytes and sniffedContentType are null until ingest commits the bytes.
    versionNumber: z.number().int(),
    sizeBytes: z.number().int().nullable(),
    sniffedContentType: z.string().nullable(),
    scanVerdict: z.enum(["unscanned", "clean", "flagged"]).nullable(),
    status: z.enum(["clean", "pending", "quarantined"]),
    // The reason a version was quarantined, present only when status is "quarantined".
    quarantineReason: z.string().nullable(),
    // The last-modified instant the uploading device reported for the display version's source file,
    // or null where none was recorded. The record's own dates stand beside it, never replaced by it.
    sourceModifiedAt: z.string().nullable(),
    // Who uploaded the display version — the member's id (kept on the version, so it outlives the
    // member row) and the name the firm calls them, null where nobody was recorded or the member row
    // is gone. An upload is an act of creation, so the table calls this Created By.
    uploadedBy: z.string().nullable(),
    uploadedByName: z.string().nullable(),
  })
  .openapi("FileSummary");

const FileListResponse = z
  .object({ data: z.array(FileSummary), nextCursor: z.string().nullable() })
  .openapi("FileListResponse");

const FileVersionItem = z
  .object({
    id: z.string(),
    versionNumber: z.number().int(),
    sizeBytes: z.number().int().nullable(),
    sniffedContentType: z.string().nullable(),
    contentSha256: z.string().nullable(),
    committedAt: z.string().nullable(),
    // Who uploaded this version, on the same terms as FileSummary's pair.
    uploadedBy: z.string().nullable(),
    uploadedByName: z.string().nullable(),
    // What kind of save cut this version from the browser editor's working copy: the member's own
    // Save, the editor's periodic autosave, the save made as the last view left, or the idle reap.
    // Null for a version that arrived by upload, check-in or restore.
    saveKind: z.enum(["explicit", "autosave", "exit", "reap"]).nullable(),
    // Everyone in the editing session when the version was cut, the author included; a member
    // whose row is gone keeps their identifier and loses only the name.
    participants: z.array(z.object({ userId: z.string(), name: z.string().nullable() })),
    // The version's standing safety verdict, the engine that reached it, and the engine's own
    // detail. Null verdict: the engine-less launch state, read as "not scanned".
    scanVerdict: z.enum(["unscanned", "clean", "flagged"]).nullable(),
    scanEngineVersion: z.string().nullable(),
    scanDetail: z.string().nullable(),
    // Who changed what in this version, read from the document's own tracked changes: one entry
    // per author with counts of what they inserted, removed and reformatted. Empty for a version
    // that recorded nothing new, or whose marks have not been read yet.
    changes: z.array(
      z.object({
        authorUserId: z.string().nullable(),
        authorName: z.string(),
        insertions: z.number().int(),
        deletions: z.number().int(),
        formatting: z.number().int(),
      }),
    ),
  })
  .openapi("FileVersionItem");

const FileVersionsResponse = paginated(FileVersionItem).openapi("FileVersionsResponse");

// One tracked change a version carries that no earlier version did, as the document holds it.
const FileVersionChangeItem = z
  .object({
    sequence: z.number().int(),
    kind: z.enum(["insertion", "deletion", "formatting"]),
    // The author as the document names them, and the member that name resolved to when the
    // version was cut (null when it resolved to nobody); authorCurrentName is that member's name
    // today, or null for a departed member.
    authorName: z.string(),
    authorUserId: z.string().nullable(),
    authorCurrentName: z.string().nullable(),
    changedAt: z.string().nullable(),
    // The words inserted, removed or reformatted; a paragraph break is a newline. Capped, and
    // textTruncated says when the cap cut them.
    text: z.string(),
    textTruncated: z.boolean(),
    part: z.string(),
    paragraphIndex: z.number().int(),
  })
  .openapi("FileVersionChangeItem");

const FileVersionChangesResponse = z
  .object({ data: z.array(FileVersionChangeItem) })
  .openapi("FileVersionChangesResponse");

const PreviewGrant = z
  .object({
    mode: z.enum(["inline-media", "download-only"]),
    // The stored verdict, READ not computed (the sniffer is deferred). NULL = never sniffed; at
    // launch the whole corpus is NULL so every grant is download-only / unknown-verdict.
    verdict: z.enum(["playable", "download-only", "indeterminate"]).nullable(),
    // Present iff mode === "inline-media": the cookieless files-host URL the player loads as a
    // <video>/<audio> subresource. The transcode rendition wires in here when the player UI lands.
    streamUrl: z.string().optional(),
    contentType: z.string().optional(), // the SNIFFED type, echoed for the player
    sizeBytes: z.number().int().nullable().optional(),
    // Present iff mode === "download-only". "host-unavailable" = the files host is not yet bound
    // (the verdict may have been playable); distinct from "unknown-verdict" (never-sniffed).
    reason: z
      .enum([
        "verdict",
        "unknown-verdict",
        "tiered",
        "encoded",
        "derived",
        "unknown-type",
        "host-unavailable",
      ])
      .optional(),
    // ALWAYS present, download-intent only — the AUDITED /download path (302), never a raw inline URL,
    // so an active format can only ever reach an explicit download, never an auto-embedding context.
    downloadUrl: z.string(),
  })
  .openapi("PreviewGrant");

const PatchFileRequest = z
  .object({
    name: z.string().min(1).optional(),
    // Present (incl. explicit null = the matter root) = a move.
    folderId: identifierField("folder").nullable().optional(),
    // Present (incl. explicit null = clear) = a document-type assignment.
    documentTypeId: identifierField("documentType").nullable().optional(),
  })
  .openapi("PatchFileRequest");

const FileActionAck = z.object({ fileId: z.string() }).openapi("FileActionAck");

const DeletedFileItem = z
  .object({
    id: z.string(),
    name: z.string(),
    // The folder the file was in when it was deleted, as stored — the folder row itself may be gone
    // by now; the restore path resolves whether the pointer still leads anywhere.
    folderId: z.string().nullable(),
    documentTypeId: z.string().nullable(),
    deletedAt: z.string(),
    // Resolved from the audit trail (the latest file.deleted row), so a system deletion or a
    // departed member renders an honest null rather than a fabricated actor.
    deletedBy: z.string().nullable(),
    deletedByName: z.string().nullable(),
    currentVersionId: z.string().nullable(),
    // The clean current version's facts; null for a file deleted before any version committed.
    sizeBytes: z.number().int().nullable(),
    sniffedContentType: z.string().nullable(),
  })
  .openapi("DeletedFileItem");

const DeletedFileListResponse = paginated(DeletedFileItem).openapi("DeletedFileListResponse");

const RestoreFileRequest = z
  .object({
    // Present = restore INTO this folder (explicit null = the matter root). Absent = the file goes
    // back where it was, falling back to the matter root when that folder no longer exists.
    folderId: identifierField("folder").nullable().optional(),
  })
  .openapi("RestoreFileRequest");

const RestoredFileAck = z
  .object({
    fileId: z.string(),
    // Where the restore actually put the file (null = the matter root) — it can differ from the
    // stored folder when the original folder is gone or a destination was chosen.
    folderId: z.string().nullable(),
  })
  .openapi("RestoredFileAck");

const FileHistoryItem = z
  .object({
    at: z.string(),
    // The raw audit event string (e.g. "file.renamed", "file.version_committed",
    // "folder.created", "document.checkin_committed").
    event: z.string(),
    // Whether the act was done to a file or to a folder. Making, renaming, moving and deleting a
    // folder are acts on the matter's files as much as any other, so the trail carries both.
    subjectKind: z.enum(["file", "folder"]),
    subjectId: z.string(),
    // Its CURRENT name, resolved at read time — a rename updates every past row's display. A
    // deleted folder's row is gone, so its own deletion event says so instead of naming it.
    subjectName: z.string(),
    // Present for version-subject events (uploads, commits, downloads); null for file-subject ones.
    versionNumber: z.number().int().nullable(),
    actorUserId: z.string().nullable(),
    actorName: z.string().nullable(),
    // The event's redacted metadata, passed through as recorded (null when the event carried none).
    detail: z.unknown().nullable(),
    // The change's from/to as display text, resolved server-side per event kind: a move/delete/
    // restore resolves its recorded folder ids to CURRENT path text ("Home" for the matter root; a
    // fixed fallback for a folder no longer on the matter); a document-type assignment resolves the
    // type's current name; a version commit renders its version number. Null wherever the recorded
    // metadata predates these facts, and always null for a rename's names — audit metadata carries
    // ids only, never file names, so those are honest blanks rather than guesses.
    fromText: z.string().nullable(),
    toText: z.string().nullable(),
  })
  .openapi("FileHistoryItem");

const FileHistoryResponse = paginated(FileHistoryItem).openapi("FileHistoryResponse");

const ArchiveEntry = z
  .object({
    // The entry's path inside the archive, normalized (forward slashes, no leading slash; traversal
    // paths never appear — the parser skips them). The client renders the levels itself.
    path: z.string(),
    isDirectory: z.boolean(),
    compressedSizeBytes: z.number().int(),
    uncompressedSizeBytes: z.number().int(),
    // The entry's recorded modification instant (the zip format keeps no zone; read as UTC), null
    // when the archive recorded none.
    modifiedAt: z.string().nullable(),
  })
  .openapi("ArchiveEntry");

const ArchiveEntriesResponse = z
  .object({
    entries: z.array(ArchiveEntry),
    // True when a cap bit (the firm's archive entry cap, or the central-directory read bound) — the
    // listing is a prefix of the archive, not the whole of it.
    truncated: z.boolean(),
  })
  .openapi("ArchiveEntriesResponse");

// Why one requested member could not be taken out and filed. Every value is a fact about that
// member — the archive's own structure, the firm's archive caps, or the firm's upload policy — never
// a generic failure, because a caller that asked for ten members needs to know which one is
// encrypted and which one the container lied about. The first eight mirror the extractor's own
// refusals verbatim (packages/file-manager/src/zip-member-extract.ts); "not-in-archive" is this
// route's own (a path the listing does not hold, or one past the firm's entry cap), and the two
// policy reasons are the ingest gate's refusals, which are per-member facts and not request faults.
const ArchiveExtractionRefusal = z.enum([
  "archive-missing",
  "directory",
  // A tar entry that is a symbolic or hard link, a device node or a pipe: it is not a file and has
  // no content of its own, which is a different fact from being a folder.
  "not-a-file",
  "encrypted",
  "unsupported-compression",
  "malformed",
  "too-large",
  "expansion-ratio",
  "corrupt",
  "not-in-archive",
  "policy-size",
  "policy-type",
]);

const ExtractArchiveMembersRequest = z
  .object({
    // Archive-relative paths, exactly as the entry listing returned them. Capped per request because
    // each one is inflated in this isolate: a hundred is a generous selection and a bounded cost.
    paths: z.array(z.string().min(1)).min(1).max(100),
    // Where the extracted members land, in the ARCHIVE'S OWN matter. Absent or null = the matter
    // root. There is deliberately no matter in this request: an extraction files what was inside a
    // matter's own zip back into that matter, and letting a caller name the destination matter would
    // make this route a cross-matter copy wearing an extraction's clothes.
    folderId: identifierField("folder").nullable().optional(),
  })
  .openapi("ExtractArchiveMembersRequest");

const ExtractedArchiveMember = z
  .object({
    // The archive-relative path as requested, so a caller can join the result back to its selection.
    path: z.string(),
    fileId: z.string(),
    versionId: z.string(),
    // The filed file's name: the path's last segment, sanitized — never the whole path.
    name: z.string(),
  })
  .openapi("ExtractedArchiveMember");

const RefusedArchiveMember = z
  .object({ path: z.string(), reason: ArchiveExtractionRefusal })
  .openapi("RefusedArchiveMember");

const ExtractArchiveMembersResponse = z
  .object({
    // Filed, in the order requested. Each version is PENDING until the ingest gate resolves it.
    extracted: z.array(ExtractedArchiveMember),
    // Not filed, and why. A partial result is the normal result: one encrypted member among ten does
    // not stop the other nine, and reporting the refusals is how the caller learns that.
    refused: z.array(RefusedArchiveMember),
  })
  .openapi("ExtractArchiveMembersResponse");

const fileParam = z.object({ id: identifierPathParam("file", "id") });
const matterParam = z.object({ matterId: identifierPathParam("matter", "matterId") });

const authErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the file is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const idempotencyErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const listFilesMeta: RouteMeta = {
  operationId: "files.list",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const getFileMeta: RouteMeta = {
  operationId: "files.get",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const listFileVersionsMeta: RouteMeta = {
  operationId: "files.versions",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchFileMeta: RouteMeta = {
  operationId: "files.update",
  surface: "app",
  authenticated: true,
  permission: FILES_ORGANIZE,
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const deleteFileMeta: RouteMeta = {
  operationId: "files.delete",
  surface: "app",
  authenticated: true,
  permission: FILES_DELETE,
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

// The download is a GET that exports bytes. A GET cannot carry an Idempotency-Key (it has no body to
// fingerprint and re-issuing it is harmless), so idempotency is "optional"; it is still audited
// because an export is a privileged read the audit trail must record (the upload signPart GET is not
// audited — it mints a credential but exports nothing).
const downloadFileMeta: RouteMeta = {
  operationId: "files.download",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

// The preview grant is a GET that exports a delivery DECISION (and, for inline media, a signed
// delivery credential) — no body to fingerprint, harmless to re-issue, so idempotency is "optional".
// permission: null is the files.list/get/download read posture — the registry deliberately has no
// read-only files capability; access is gated by which matter the member can reach, enforced by the
// firm-scoped query against the session firm's physically-isolated D1. audited: false because inline
// preview is a cheap, high-frequency in-place view (no per-view logging); the moment the user pulls
// the full file, the audited /download path records it. Reasoning home: docs/conventions/security.md.
const previewFileMeta: RouteMeta = {
  operationId: "files.preview",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

// The recovery view's list — the same read posture as files.list (any authenticated firm member;
// access is gated by which matter the member can reach in the firm's physically-isolated D1).
const listDeletedFilesMeta: RouteMeta = {
  operationId: "files.listDeleted",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

// Restore rides files:delete: deleting and undeleting are the same custody bracket — a separate
// restore capability would be a permission nobody would set differently (the deleted-files
// retention design records this as an owner recommendation).
const restoreFileMeta: RouteMeta = {
  operationId: "files.restore",
  surface: "app",
  authenticated: true,
  permission: FILES_DELETE,
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

// Browse Inside a zip: the files.list/get read posture (any authenticated firm member, gated by
// which matter the member can reach), not audited for the same reason preview is not — a cheap
// in-place metadata read; pulling actual bytes still goes through the audited /download path.
const archiveEntriesMeta: RouteMeta = {
  operationId: "files.archiveEntries",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

// THE ENGINES THIS DEPLOYMENT HAS. `@magna-carta/file-manager` owns every archive decision and
// declares the engines it cannot import; this is where they are supplied. A format whose engine is
// missing refuses by name rather than crashing, so a deployment that has not wired one is a
// deployment that says so.
const ARCHIVE_ENGINES: ArchiveEngines = { sevenZip: sevenZipEngine };

// Extract from an archive: the read posture above does not carry here, because this WRITES files
// into the matter. It rides files:upload — the same capability a direct upload rides, since a member
// taken out of an archive becomes an ordinary matter file by the ordinary gate — and it is audited,
// because each filed member is a new document whose only provenance is the row this route writes.
// rateLimit "expensive": every member is unpacked and stored in this isolate.
/**
 * What to tell a person about a 7z the engine would not list.
 *
 * `notSevenZip` and `malformed` are the two that are statements about the bytes rather than about
 * this application, so they answer as the zip reader's equivalent does — the content is not a
 * readable archive. The rest are archives that are genuinely fine and that this application cannot
 * show the inside of, which is a different thing to say and is said separately.
 */
function sevenZipRefusal(
  error: SevenZipListingError,
): { type: ProblemTypeKey; detail: string } | null {
  switch (error.code) {
    case "notSevenZip":
    case "malformed":
      return null;
    case "headerEncrypted":
      return {
        type: "archive-unreadable",
        detail:
          "This 7z archive's own list of files is encrypted, so what is inside it cannot be shown " +
          "without the password it was packed with. The archive can still be downloaded.",
      };
    case "unsupportedVersion":
    case "unsupportedCoder":
      return {
        type: "archive-unreadable",
        detail:
          "This 7z archive stores its list of files in a form this application cannot read. The " +
          "archive can still be downloaded.",
      };
    case "tooLarge":
      return {
        type: "archive-unreadable",
        detail:
          "This 7z archive's list of files is too large to read here. The archive can still be " +
          "downloaded.",
      };
    // The engine asked for bytes it had not named, which is this application's fault rather than the
    // archive's. It is still answered rather than raised as a fault, because whoever is looking at
    // the file needs to know the listing did not happen, and the error log carries the rest.
    case "rangeMismatch":
    // The four an extraction can raise and a listing cannot. Unreachable from this route, and
    // answered rather than left to fall off the end of the switch: a code this function does not
    // recognise must still produce a sentence, never a crash on somebody's archive.
    case "memberNotFound":
    case "notAFile":
    case "memberEncrypted":
    case "corrupt":
      return {
        type: "archive-unreadable",
        detail:
          "What is inside this 7z archive could not be read. The archive can still be downloaded.",
      };
  }
}

const extractArchiveMembersMeta: RouteMeta = {
  operationId: "files.extractArchiveMembers",
  surface: "app",
  authenticated: true,
  permission: FILES_UPLOAD,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
};

const fileHistoryMeta: RouteMeta = {
  operationId: "files.history",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const listFilesRoute = defineOpenAPIRoute(listFilesMeta, {
  method: "get",
  path: "/api/v1/files",
  description:
    "Lists a matter's files (optionally a single folder), cursor-paginated. Each row carries its " +
    "display version's number, size, sniffed type, scan verdict, and status, so one call paints a file " +
    "table with no per-row fan-out to the version history. By default only files with a committed clean " +
    "version appear (soft-deleted files are always excluded). Set includePendingAndQuarantined=true to " +
    "also surface files whose latest version is still processing (pending) or was rejected as malware " +
    "(quarantined); those rows carry a null currentVersionId and cannot be downloaded.",
  request: {
    query: z.object({
      matterId: identifierField("matter"),
      folderId: identifierField("folder").optional(),
      cursor: z.string().optional(),
      pageSize: z.coerce.number().int().positive().max(200).optional(),
      // Opt-in: include files whose latest version is pending or quarantined (default: clean only).
      includePendingAndQuarantined: z.literal("true").optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of files",
      content: { "application/json": { schema: FileListResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const getFileRoute = defineOpenAPIRoute(getFileMeta, {
  method: "get",
  path: "/api/v1/files/{id}",
  description:
    "Returns one file's metadata. A pending-only, quarantined, or soft-deleted file is 404.",
  request: { params: fileParam },
  responses: {
    200: { description: "The file", content: { "application/json": { schema: FileSummary } } },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listFileVersionsRoute = defineOpenAPIRoute(listFileVersionsMeta, {
  method: "get",
  path: "/api/v1/files/{id}/versions",
  description:
    "Lists a file's committed (clean) version history, newest first. CURSOR-PAGED: a version " +
    "history only grows, and a document under daily revision for years is thousands of versions " +
    "that this read carried no bound on at all.",
  request: { params: fileParam, query: cursorQuery },
  responses: {
    200: {
      description: "The file's clean version history",
      content: { "application/json": { schema: FileVersionsResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listFileVersionChangesMeta: RouteMeta = {
  operationId: "files.versionChanges",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const fileVersionParam = z.object({
  id: identifierPathParam("file", "id"),
  versionId: identifierPathParam("fileVersion", "versionId"),
});

const listFileVersionChangesRoute = defineOpenAPIRoute(listFileVersionChangesMeta, {
  method: "get",
  path: "/api/v1/files/{id}/versions/{versionId}/changes",
  description:
    "Lists what changed in one version, read from the document's own tracked changes: who inserted, " +
    "removed or reformatted which words, in document order. Only the marks this version carries " +
    "that no earlier version did. Bounded per version; the words of one change are capped.",
  request: { params: fileVersionParam },
  responses: {
    200: {
      description: "The version's changes, in document order",
      content: { "application/json": { schema: FileVersionChangesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const patchFileRoute = defineOpenAPIRoute(patchFileMeta, {
  method: "patch",
  path: "/api/v1/files/{id}",
  description:
    "Renames a file, moves it to another folder (or the matter root), and/or assigns a document " +
    "type. Metadata only — the file's bytes and versions are untouched.",
  request: {
    headers: idempotencyKeyHeader,
    params: fileParam,
    body: { content: { "application/json": { schema: PatchFileRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The file was updated",
      content: { "application/json": { schema: FileActionAck } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const deleteFileRoute = defineOpenAPIRoute(
  { ...deleteFileMeta, reversal: { kind: "inverse", by: "files.restore" } },
  {
    method: "delete",
    path: "/api/v1/files/{id}",
    description:
      "Soft-deletes a file: it leaves the default listing and download but its rows and bytes are " +
      "retained, indefinitely by default. Bytes are never destroyed while another file, live or " +
      "deleted, holds the same content; only a retention policy destroys them, and only once the " +
      "last file holding them is gone.",
    request: { headers: idempotencyKeyHeader, params: fileParam },
    responses: {
      200: {
        description: "The file was soft-deleted",
        content: { "application/json": { schema: FileActionAck } },
      },
      400: idempotencyErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: idempotencyErrors[409],
      422: idempotencyErrors[422],
      429: authErrors[429],
    },
  },
);

const downloadFileRoute = defineOpenAPIRoute(downloadFileMeta, {
  method: "get",
  path: "/api/v1/files/{id}/download",
  description:
    "Resolves the file's current clean version and redirects (302) to a short-TTL presigned GET URL " +
    "the client downloads the bytes directly from. 404 when the file has no clean current version. " +
    "When a re-scan has flagged the current version as malware, the file stays accessible (no data " +
    "loss) but the raw download is gated: a 409 carrying the signature unless the caller re-requests " +
    "with acknowledgeMalware=true, which proceeds and is audited as an acknowledged override.",
  request: {
    params: fileParam,
    query: z.object({
      // Informed access: a version a re-scan flagged stays downloadable, but only with an
      // explicit acknowledgment — the member confirms they accept the risk. Absent it, the download
      // returns 409 with the signature so the UI can prompt.
      acknowledgeMalware: z.literal("true").optional(),
    }),
  },
  responses: {
    302: { description: "Redirect to the presigned download URL" },
    401: authErrors[401],
    404: authErrors[404],
    409: {
      description:
        "The current version was flagged as malware; re-request with acknowledgeMalware=true to download it",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: authErrors[429],
  },
});

const previewFileRoute = defineOpenAPIRoute(previewFileMeta, {
  method: "get",
  path: "/api/v1/files/{id}/preview",
  description:
    "Authorizes inline preview of the file's current clean version and returns a delivery " +
    "descriptor. When the verdict + storage facts permit inline media, the descriptor carries a " +
    "short-lived signed streamUrl on the cookieless files host the player loads as a <video>/<audio> " +
    "subresource; otherwise it carries download-only with a reason. downloadUrl (the audited " +
    "download path) is always present. Untrusted bytes are served cookieless so a malicious file " +
    "reaches only the media decoder, never a privileged origin. 404 when the file has no clean " +
    "current version.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The preview delivery descriptor",
      content: { "application/json": { schema: PreviewGrant } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listDeletedFilesRoute = defineOpenAPIRoute(listDeletedFilesMeta, {
  method: "get",
  path: "/api/v1/matters/{matterId}/files/deleted",
  description:
    "Lists a matter's soft-deleted files — the recovery view — newest deletion first, " +
    "cursor-paginated. Each row carries when it was deleted, who deleted it (resolved from the " +
    "audit trail; null for a system deletion), the folder it was in (the folder itself may since " +
    "be gone), and the clean current version's size and sniffed type when one exists. Deleted " +
    "files stay restorable indefinitely by default.",
  request: {
    params: matterParam,
    query: z.object({
      cursor: z.string().optional(),
      pageSize: z.coerce.number().int().positive().max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of the matter's deleted files",
      content: { "application/json": { schema: DeletedFileListResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const restoreFileRoute = defineOpenAPIRoute(restoreFileMeta, {
  method: "post",
  path: "/api/v1/files/{id}/restore",
  description:
    "Restores a soft-deleted file to the default listing. With no folderId the file returns to the " +
    "folder it was deleted from, falling back to the matter root if that folder no longer exists; " +
    "pass folderId to restore into a chosen folder (null = the matter root; the folder must belong " +
    "to the file's matter). A file that is not deleted answers 409.",
  request: {
    headers: idempotencyKeyHeader,
    params: fileParam,
    body: { content: { "application/json": { schema: RestoreFileRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The file was restored; folderId reports where it landed",
      content: { "application/json": { schema: RestoredFileAck } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: {
      description:
        "The file is not deleted (nothing to restore), or a request with this Idempotency-Key is " +
        "still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const archiveEntriesRoute = defineOpenAPIRoute(archiveEntriesMeta, {
  method: "get",
  path: "/api/v1/files/{id}/archive-entries",
  description:
    "Lists a zip file's entries by reading only the archive's central directory from storage — " +
    "nothing is extracted, and the archive's bytes are never fetched. Works for a live file and " +
    "for a soft-deleted one alike (browsing a deleted zip restores nothing). The flat entry list " +
    "carries each entry's path, directory flag, sizes, and recorded modification time; truncated " +
    "reports when the firm's archive entry cap cut the listing short. 409 when the file has no " +
    "committed bytes yet; 422 when the file is not a zip archive.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The archive's entry listing",
      content: { "application/json": { schema: ArchiveEntriesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    409: {
      description: "The file has no committed version yet, so there are no bytes to read",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The file is not a zip archive",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: authErrors[429],
  },
});

const extractArchiveMembersRoute = defineOpenAPIRoute(extractArchiveMembersMeta, {
  method: "post",
  path: "/api/v1/files/{id}/archive-extractions",
  description:
    "Takes named members out of a zip file and files each one as a real file on the archive's own " +
    "matter, through the ordinary ingest gate — the same sniff, hash, scan and commit an upload " +
    "gets, because the name inside an archive is the other party's claim about its contents and " +
    "nothing has inspected these bytes before. Paths are archive-relative, exactly as the entry " +
    "listing returns them; folderId names a destination folder in that matter (null or absent = the " +
    "matter root). The destination matter is always the archive's own, and a soft-deleted archive is " +
    "a valid source (the member is filed into the live matter; the archive stays deleted). Answers " +
    "202 with what was filed and what was refused — a partial result is the normal result, and each " +
    "filed version is pending until the ingest gate resolves it. 409 when the archive has no " +
    "committed bytes; 422 when it is not a zip, or the request fails validation.",
  request: {
    params: fileParam,
    body: {
      content: { "application/json": { schema: ExtractArchiveMembersRequest } },
      required: true,
    },
  },
  responses: {
    202: {
      description:
        "Accepted: each extracted member's rows and audit were committed and its bytes were " +
        "written. Every version is pending until the ingest gate commits or quarantines it. " +
        "Members that could not be taken out are reported in refused, by reason.",
      content: { "application/json": { schema: ExtractArchiveMembersResponse } },
    },
    400: {
      description: "The request body is absent or is not JSON",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: {
      description:
        "No such file in this firm, its stored bytes are gone, or the destination folder is unknown",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "The file has no committed version yet, so there are no bytes to extract from",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The file is not a zip archive, or the request names no paths (or more than the cap)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: authErrors[429],
  },
});

const fileHistoryRoute = defineOpenAPIRoute(fileHistoryMeta, {
  method: "get",
  path: "/api/v1/matters/{matterId}/file-history",
  description:
    "The matter's file activity trail, read from the audit log: uploads, version commits, renames, " +
    "moves, document-type changes, deletions, restores, downloads, and check-in/checkout events — " +
    "newest first, cursor-paginated. File names are the files' current names, resolved at read " +
    "time; detail passes through each event's recorded (redacted) metadata.",
  request: {
    params: matterParam,
    query: z.object({
      cursor: z.string().optional(),
      pageSize: z.coerce.number().int().positive().max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of the matter's file history",
      content: { "application/json": { schema: FileHistoryResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

type FilesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function fileErrorResponse(
  c: Context,
  error: FileManagerValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  // A blank or whitespace-only name: well-formed request, unusable value — unprocessable, not missing.
  if (error.code === "invalid-name") {
    return problemJson(c, {
      type: "validation",
      title: "File name is not usable",
      status: 422,
      detail: error.message,
    });
  }
  // Restoring a file that is not deleted: the file is visible to the caller, so the honest answer is
  // a conflict — the caller's picture of the file is stale — never a fabricated absence.
  if (error.code === "file-not-deleted") {
    return problemJson(c, {
      type: "conflict",
      title: "File is not deleted",
      status: 409,
      detail: "This file is not deleted, so there is nothing to restore.",
    });
  }
  if (
    error.code === "unknown-file" ||
    // A soft-deleted file is 404 on every read, so a write against one answers the same way — the
    // mutation paths must not be where a caller learns a deleted file is still there.
    error.code === "file-deleted" ||
    error.code === "unknown-folder" ||
    // A move whose target folder lives in another matter targets a resource not in this matter —
    // surfaced as not-found, never a 500.
    error.code === "file-cross-matter"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such file in this firm.",
    });
  }
  throw error;
}

// Projects the file-manager summary onto the FileSummary wire shape — shared by the list and the
// single-file detail read so the two never drift.
function toFileSummaryResponse(file: FileListItem): z.infer<typeof FileSummary> {
  return {
    id: file.id,
    matterId: file.matterId,
    folderId: file.folderId,
    name: file.name,
    documentTypeId: file.documentTypeId,
    currentVersionId: file.currentVersionId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    versionNumber: file.versionNumber,
    sizeBytes: file.sizeBytes,
    sniffedContentType: file.sniffedContentType,
    scanVerdict: file.scanVerdict,
    status: file.status,
    quarantineReason: file.quarantineReason,
    sourceModifiedAt: file.sourceModifiedAt,
    uploadedBy: file.uploadedBy,
    uploadedByName: file.uploadedByName,
  };
}

// The visible file (clean current version, not soft-deleted) by id — the get/versions/download reads
// all start here so a pending-only, quarantined, or deleted file is uniformly 404.
async function loadVisibleFile(
  database: Parameters<typeof selectFileStatement>[0],
  id: FileId,
): Promise<
  | {
      id: FileId;
      matterId: MatterId;
      folderId: FolderId | null;
      name: string;
      documentTypeId: string | null;
      currentVersionId: FileVersionId | null;
      deletedAt: string | null;
      createdAt: string;
    }
  | undefined
> {
  const { results } = await selectFileStatement(database, id).all<{
    id: FileId;
    matter_id: MatterId;
    folder_id: FolderId | null;
    name: string;
    document_type_id: string | null;
    current_version_id: FileVersionId | null;
    deleted_at: string | null;
    created_at: string;
  }>();
  const row = results[0];
  if (row === undefined || row.deleted_at !== null || row.current_version_id === null) {
    return undefined;
  }
  return {
    id: row.id,
    matterId: row.matter_id,
    folderId: row.folder_id,
    name: row.name,
    documentTypeId: row.document_type_id,
    currentVersionId: row.current_version_id,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  };
}

type FilesContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

// The name an extracted member is filed under: the LAST SEGMENT of its archive path, never the path
// itself. A path is where the member sat inside somebody else's container; a file name is what a
// person will read in the matter, and joining directories into it would make every extraction from a
// nested archive read as one long string. The rest is defence: separators collapse, control
// characters go (a name that renders one way and sorts another is a name nobody can act on), leading
// dots go so a member called "../etc" or ".hidden" cannot address anything or arrive invisible, and
// a name that sanitizes down to nothing gets a positional stand-in rather than an empty file name.
function extractedMemberName(archivePath: string, index: number): string {
  const segments = archivePath.split("/");
  const base = (segments[segments.length - 1] ?? archivePath)
    .replace(/[/\\]/g, "_")
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return base.length > 0 ? base : `extracted-${index + 1}`;
}

// One member's bytes -> one file on the matter, riding the ordinary ingest gate: initiateUpload mints
// the pending file + version + session exactly as a direct upload does, so the same async consumer
// (sniff, hash, scan, commit-or-quarantine) governs these bytes. Nothing here copies a verdict from
// anywhere: the archive's contents have never been inspected, and duplicating a version would inherit
// a verdict that was never earned.
//
// THE ORDER IS THE CORRECTNESS RULE. The metadata batch — the pending rows AND this extraction's
// audit row, one batch — commits BEFORE the bytes are written, so a verdict can never land on a
// document the record does not know about and a failed commit leaves no orphan object behind for the
// consumer to find. The session is completed and committed once the bytes are in, and the ingest
// event is enqueued last of all.
async function fileExtractedMember(
  c: FilesContext,
  member: {
    readonly bytes: Uint8Array;
    readonly name: string;
    readonly matterId: MatterId;
    readonly folderId: FolderId | null;
    readonly sourceModifiedAt: string | null;
    readonly archiveFileId: FileId;
    readonly archivePath: string;
  },
): Promise<{ fileId: string; versionId: string }> {
  const firm = requireChokepointFirmContext(c);
  const userId = requireChokepointUserId(c);
  // The one resolver every R2-touching path shares, so these bytes land in the bucket the ingest
  // consumer reads them back from and the event names that same bucket.
  const { bucket, bucketName } = resolveFirmBucket(c.env, firm.bucketName);
  const now = () => new Date().toISOString();
  const auditContext = { clock: { now }, actorUserId: userId };

  const initiated = await initiateUpload(
    firm.firmDatabase,
    {
      matterId: member.matterId,
      folderId: member.folderId,
      name: member.name,
      declaredSize: member.bytes.byteLength,
      // Deliberately not declared. The entry's name inside an archive is the other side's claim about
      // what it is, and the gate sniffs the real bytes; declaring a type here would be feeding that
      // claim into the check meant to test it.
      declaredContentType: null,
      uploadedBy: userId,
      mode: "put",
      uploadKind: "interactive",
      // The instant the archive recorded for this member — a real fact about where the bytes came
      // from, and the only date the member carries.
      sourceModifiedAt: member.sourceModifiedAt,
    },
    auditContext,
  );

  await commitEffectBatch(
    firm.firmDatabase,
    {
      statements: [
        ...initiated.effect.statements,
        // Rides the SAME batch as the rows it describes: a member filed with no record of the
        // container it came out of is a document with no provenance, and the provenance is most of
        // what an extracted member is worth. Ids and the in-archive path only — the path is where
        // this document sat inside the container, which is the fact being recorded.
        // The archive this came out of, by id. NOT the member's path inside it: audit metadata on
        // this surface carries ids and never names (the file-history contract says so above), and a
        // path inside a client's archive can carry as much as a document title does. Which archive
        // is the provenance question; which member is answered by the extracted file's own record.
        fileAuditStatement(firm.firmDatabase, auditContext, "file.extracted", initiated.versionId, {
          archiveFileId: member.archiveFileId,
        }),
      ],
      outboxMessages: initiated.effect.outboxMessages,
    },
    { now },
  );

  await bucket.put(initiated.r2Key, member.bytes, { customMetadata: initiated.dimensions });

  const completed = await completeUploadSession(
    firm.firmDatabase,
    initiated.uploadSessionId as UploadSessionId,
    auditContext,
  );
  await commitEffectBatch(firm.firmDatabase, completed.effect, { now });

  // The gate runs on these bytes exactly as it does for an upload. Enqueued last, after everything
  // that names the version has committed.
  await enqueueDevIngestEvent(c.env, bucketName, initiated.r2Key, member.bytes.byteLength);
  return { fileId: initiated.fileId, versionId: initiated.versionId };
}

export function registerFilesRoutes(app: FilesApp, chokepoint: Chokepoint): void {
  // GET /api/v1/files — list
  app.openapi(
    {
      ...listFilesRoute,
      middleware: chokepointMiddleware(chokepoint, listFilesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const page = await listFiles(firm.firmDatabase, {
        matterId: query.matterId,
        folderId: query.folderId,
        cursor: query.cursor,
        pageSize: query.pageSize,
        includePendingAndQuarantined: query.includePendingAndQuarantined === "true",
      });
      return c.json(
        {
          data: page.data.map(toFileSummaryResponse),
          nextCursor: page.nextCursor,
        } as z.infer<typeof FileListResponse>,
        200,
      );
    },
  );

  // GET /api/v1/files/{id} — detail
  app.openapi(
    { ...getFileRoute, middleware: chokepointMiddleware(chokepoint, getFileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const file = await getFileSummary(firm.firmDatabase, id);
      if (file === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file in this firm.",
        });
      }
      return c.json(toFileSummaryResponse(file), 200);
    },
  );

  // GET /api/v1/files/{id}/versions — clean version history
  app.openapi(
    {
      ...listFileVersionsRoute,
      middleware: chokepointMiddleware(chokepoint, listFileVersionsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const file = await loadVisibleFile(firm.firmDatabase, id);
      if (file === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file in this firm.",
        });
      }
      const { cursor } = c.req.valid("query");
      const page = await listCleanVersions(
        firm.firmDatabase,
        id,
        cursor === undefined ? {} : { cursor },
      );
      // One grouped read for the page, never one per version.
      const summaries = await summarizeVersionChanges(
        firm.firmDatabase,
        page.data.map((version) => version.id),
      );
      return c.json(
        {
          nextCursor: page.nextCursor,
          data: page.data.map((version) => ({
            id: version.id,
            changes: summaries
              .filter((summary) => summary.versionId === version.id)
              .map((summary) => ({
                authorUserId: summary.authorUserId,
                authorName: summary.authorName,
                insertions: summary.insertions,
                deletions: summary.deletions,
                formatting: summary.formatting,
              })),
            versionNumber: version.versionNumber,
            sizeBytes: version.sizeBytes,
            sniffedContentType: version.sniffedContentType,
            contentSha256: version.contentSha256,
            committedAt: version.committedAt,
            saveKind: version.saveKind,
            participants: version.participants.map((participant) => ({
              userId: participant.userId,
              name: participant.name,
            })),
            uploadedBy: version.uploadedBy,
            uploadedByName: version.uploadedByName,
            scanVerdict: version.scanVerdict,
            scanEngineVersion: version.scanEngineVersion,
            scanDetail: version.scanDetail,
          })),
        } as z.infer<typeof FileVersionsResponse>,
        200,
      );
    },
  );

  // GET /api/v1/files/{id}/versions/{versionId}/changes — what changed in one version, by whom
  app.openapi(
    {
      ...listFileVersionChangesRoute,
      middleware: chokepointMiddleware(chokepoint, listFileVersionChangesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id, versionId } = c.req.valid("param");
      // The version is resolved through the same gate every version read takes: a soft-deleted
      // file, a withdrawn version, or a version of another file all answer 404.
      const file = await getFileWithNamedVersion(firm.firmDatabase, id, versionId);
      if (file === undefined || file.deletedAt !== null || file.version === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such version of this file in this firm.",
        });
      }
      const changes = await listVersionChanges(firm.firmDatabase, versionId);
      return c.json(
        {
          data: changes.map((change) => ({
            sequence: change.sequence,
            kind: change.kind,
            authorName: change.authorName,
            authorUserId: change.authorUserId,
            authorCurrentName: change.authorCurrentName,
            changedAt: change.changedAt,
            text: change.text,
            textTruncated: change.textTruncated,
            part: change.part,
            paragraphIndex: change.paragraphIndex,
          })),
        } as z.infer<typeof FileVersionChangesResponse>,
        200,
      );
    },
  );

  // PATCH /api/v1/files/{id} — rename / move / assign document type
  app.openapi(
    {
      ...patchFileRoute,
      middleware: chokepointMiddleware(chokepoint, patchFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const now = () => new Date().toISOString();
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const statements: EffectStatement[] = [];
            const outboxMessages: OutboxMessage[] = [];
            if (patch.name !== undefined) {
              const renamed = await renameFile(firm.firmDatabase, id, patch.name, {
                clock: { now },
                actorUserId: userId,
              });
              statements.push(...renamed.effect.statements);
              outboxMessages.push(...renamed.effect.outboxMessages);
            }
            if (patch.folderId !== undefined) {
              const moved = await moveFile(firm.firmDatabase, id, patch.folderId, {
                clock: { now },
                actorUserId: userId,
              });
              statements.push(...moved.effect.statements);
              outboxMessages.push(...moved.effect.outboxMessages);
            }
            if (patch.documentTypeId !== undefined) {
              const assigned = await assignDocumentType(
                firm.firmDatabase,
                id,
                patch.documentTypeId,
                {
                  clock: { now },
                  actorUserId: userId,
                },
              );
              statements.push(...assigned.effect.statements);
              outboxMessages.push(...assigned.effect.outboxMessages);
            }
            return {
              write: { statements, outboxMessages },
              responseCode: 200,
              responseBody: canonicalJsonStringify({ fileId: id }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
        const body = JSON.parse(storedResponseBody(result)) as z.infer<typeof FileActionAck>;
        return c.json(body, 200);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) return fileErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // DELETE /api/v1/files/{id} — soft delete
  app.openapi(
    {
      ...deleteFileRoute,
      middleware: chokepointMiddleware(chokepoint, deleteFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const now = () => new Date().toISOString();
      // Reap any live editing session first so the file is not deleted out from under live editors with
      // a stranded session/lock. Idempotent — force-closing an already-idle session is a no-op.
      await documentSessionStub(c.env, id).forceClose();
      // Captured inside the effect so the working-copy object is destroyed only after the soft-delete
      // batch commits (and only by the winner of the idempotency race).
      let currentR2KeyToDestroy: string | null = null;
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const deleted = await softDeleteFile(firm.firmDatabase, id, {
              clock: { now },
              actorUserId: userId,
            });
            currentR2KeyToDestroy = deleted.currentR2Key;
            return {
              write: deleted.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ fileId: id }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        // Destroy the live working copy only on the winning execution (a replay's batch rolled back and
        // the winner already handled it). The committed versions and their bytes are retained: a
        // version's bytes may stand behind other files too, and the only door to destroying them is
        // purgeableVersionObjects in @magna-carta/file-manager, which a retention policy walks —
        // never this route. The working copy is keyed to this file alone, so it is the one object a
        // delete may take with it.
        if (result.kind === "executed" && currentR2KeyToDestroy !== null) {
          // Destroy it in the firm's own bucket — the one the working copy was written to.
          await resolveFirmBucket(c.env, firm.bucketName).bucket.delete(currentR2KeyToDestroy);
        }
        if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
        const body = JSON.parse(storedResponseBody(result)) as z.infer<typeof FileActionAck>;
        return c.json(body, 200);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) return fileErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/files/{id}/download — 302 to a presigned GET of the current clean version
  app.openapi(
    {
      ...downloadFileRoute,
      middleware: chokepointMiddleware(chokepoint, downloadFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const bucket = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const { id } = c.req.valid("param");
      const version = await getCurrentCleanVersion(firm.firmDatabase, id);
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file with a downloadable version in this firm.",
        });
      }
      // When a re-scan has flagged the committed version, the response depends on the firm's configured
      // flagged-file treatment. Resolve both settings in parallel to avoid two serial reads.
      const acknowledgedMalware = c.req.valid("query").acknowledgeMalware === "true";
      let downloadAuditEvent: string = "file.downloaded";
      let downloadAuditExtra: Record<string, unknown> = {};
      if (version.scanVerdict === "flagged") {
        const [treatment, stepUpReauth] = await Promise.all([
          readFlaggedTreatment(firm.firmDatabase),
          readStepUpReauthOnFlagged(firm.firmDatabase),
        ]);
        if (treatment === "block") {
          // block means inaccessible: a flagged version under block treatment is never served, and the
          // acknowledgment override is NOT honored — there is no way to download it through this path.
          // A flagged+committed version can reach here after a re-scan flips an older clean version's
          // verdict, or after a policy change to block; refusing here is the access-side enforcement of
          // the firm's quarantine policy. The denied attempt is recorded (metadata only, no content).
          const now = new Date().toISOString();
          await commitEffectBatch(
            firm.firmDatabase,
            {
              statements: [
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "file.download_blocked_flagged",
                  actorUserId: userId,
                  subjectId: version.id,
                  metadata: { fileId: id, versionId: version.id, flagged: true },
                  now,
                }),
              ],
              outboxMessages: [],
            },
            { now: () => now },
          );
          return problemJson(c, {
            type: "malware-flagged",
            title: "File flagged as malware",
            status: 403,
            detail:
              "This file is flagged and the firm's policy blocks access to flagged files." +
              (version.scanDetail ? ` (${version.scanDetail})` : ""),
          });
        }
        if (treatment === "allow-and-flag") {
          // Serve the file without an acknowledgment gate; the audit carries a flagged marker so the
          // access is visible in the audit trail.
          downloadAuditExtra = { flagged: true };
        } else {
          // informed-access: gate behind acknowledgment + audit the override.
          if (!acknowledgedMalware) {
            return problemJson(c, {
              type: "malware-flagged",
              title: "File flagged as malware",
              status: 409,
              detail:
                "This file was flagged as containing malware" +
                (version.scanDetail ? ` (${version.scanDetail})` : "") +
                ". Re-request with acknowledgeMalware=true to download it anyway; the access is recorded.",
              // Forward seam: when the firm enables step-up re-auth for flagged downloads, signal it
              // here so the client can show a re-auth prompt. The challenge is wired in a later auth
              // slice — for now this is metadata only, not an enforcement gate.
              ...(stepUpReauth ? { stepUpRequired: true } : {}),
            });
          }
          // A distinct event when the member downloaded a malware-flagged file after acknowledging it —
          // the audited override is the record of who pulled known-bad bytes and when.
          downloadAuditEvent = "file.downloaded_malware_acknowledged";
        }
      }
      // Access-triggered re-scan: if this version is stale vs the firm's current engine, re-scan it in
      // the background. Fire-and-forget — never blocks the download.
      runInBackground(
        c,
        maybeEnqueueRescanOnAccess(
          c.env.FILES_INGEST,
          firm.firmDatabase,
          firm.bucketName,
          version.r2Key,
          version.sizeBytes,
        ),
      );
      const presigner = presignerForEnv(c.env);
      // The signed URL binds to the KEY, not to the bytes: R2 serves whatever object sits at that key
      // when the client follows the redirect. What makes the clean verdict this route just read
      // trustworthy is the ingest consumer's custody gate (../files/ingest-consumer.ts) — an
      // object-create event for an already-committed version re-measures the stored bytes against the
      // hash recorded at commit and withdraws the version when they differ, so a swapped object stops
      // passing this route's status gate rather than being served under the old verdict.
      //
      // The KEY is the version's export object, not its own: a word-processing version the editor
      // cut keeps its tracked changes, and a copy that leaves is served from the copy with every
      // change accepted (../exports/export-object.ts). The audit says which it was.
      const now = new Date().toISOString();
      const exportObject = await resolveExportObject(
        firm.firmDatabase,
        resolveFirmBucket(c.env, firm.bucketName).bucket,
        version,
        () => now,
      );
      const url = await presigner.presignGet(bucket, exportObject.r2Key, DOWNLOAD_TTL_SECONDS);
      // The export is recorded before the redirect — metadata names the version exported, no content.
      //
      // TWO RECORDS, AND THEY ANSWER DIFFERENT QUESTIONS. The audit entry is the FIRM's: who pulled
      // which version, readable by whoever reviews the trail. The register row is the MEMBER's own —
      // "what did I download, and can I have it again" — and it is why this route writes one at all
      // (the owner's ruling of 2026-09-16 that every download registers). They ride the same batch
      // so a download cannot be audited without being registered, or the reverse.
      //
      // It is a REFERENCE, which means it holds no object key and cannot be presigned from the
      // register: coming back for this file returns here, and this route's own capability check runs
      // again. That is what keeps the row a record rather than a standing grant.
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: downloadAuditEvent,
              actorUserId: userId,
              subjectId: version.id,
              metadata: {
                fileId: id,
                versionId: version.id,
                ...downloadAuditExtra,
                // Only for a version that records changes: whether the copy handed out had them
                // accepted, or went out with its marks because no copy could be made.
                ...(exportObject.disposition !== "not-needed" && {
                  exportCopy: exportObject.disposition,
                }),
              },
              now,
            }),
            registerDownload(firm.firmDatabase, {
              memberId: userId,
              now: new Date(now),
              registration: {
                producer: "file",
                title: version.name,
                fileId: id,
                byteSize: version.sizeBytes,
              },
            }).statement,
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      return c.redirect(url, 302);
    },
  );

  // GET /api/v1/files/{id}/preview — authorize inline preview; mint a signed cookieless streamUrl
  app.openapi(
    {
      ...previewFileRoute,
      middleware: chokepointMiddleware(chokepoint, previewFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const bucket = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const { id } = c.req.valid("param");
      const version = await readPreviewVersion(c.env, firm, id);
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file with a previewable version in this firm.",
        });
      }
      // Access-triggered re-scan (same as /download): a stale version is re-scanned in the background.
      runInBackground(
        c,
        maybeEnqueueRescanOnAccess(
          c.env.FILES_INGEST,
          firm.firmDatabase,
          firm.bucketName,
          version.r2Key,
          version.sizeBytes,
        ),
      );
      const downloadUrl = `/api/v1/files/${id}/download`;
      const decision = decidePreview(version);
      const filesOrigin = c.env.FILES_ORIGIN;

      // Degrade to download-only when inline is not warranted OR the files host is not yet bound. The
      // reason distinguishes the two: a real decidePreview reason when the gate refused, else
      // "host-unavailable" when the gate WOULD have served inline but the cookieless host is unbound.
      if (decision.kind === "download-only" || filesOrigin === undefined) {
        const grant: z.infer<typeof PreviewGrant> = {
          mode: "download-only",
          verdict: version.inlinePlayable,
          reason: decision.kind === "download-only" ? decision.reason : "host-unavailable",
          downloadUrl,
        };
        return c.json(grant, 200, { "Cache-Control": "private, no-store" });
      }

      const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
      const token = await mintPreviewDeliveryToken(c.env.AUTH_SECRET, {
        r2Key: decision.r2Key,
        bucket,
        sniffedContentType: decision.sniffedContentType,
        verdict: version.inlinePlayable,
        exp,
      });
      const grant: z.infer<typeof PreviewGrant> = {
        mode: "inline-media",
        verdict: version.inlinePlayable,
        streamUrl: `https://${filesOrigin}/api/files-preview/${token}`,
        contentType: decision.sniffedContentType,
        sizeBytes: decision.sizeBytes,
        downloadUrl,
      };
      return c.json(grant, 200, { "Cache-Control": "private, no-store" });
    },
  );

  // GET /api/v1/matters/{matterId}/files/deleted — the recovery view's list
  app.openapi(
    {
      ...listDeletedFilesRoute,
      middleware: chokepointMiddleware(chokepoint, listDeletedFilesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { cursor, pageSize } = c.req.valid("query");
      const page = await listDeletedFiles(firm.firmDatabase, matterId, {
        ...(cursor === undefined ? {} : { cursor }),
        ...(pageSize === undefined ? {} : { pageSize }),
      });
      return c.json(
        {
          data: page.data.map((row) => ({
            id: row.id,
            name: row.name,
            folderId: row.folderId,
            documentTypeId: row.documentTypeId,
            deletedAt: row.deletedAt,
            deletedBy: row.deletedBy,
            deletedByName: row.deletedByName,
            currentVersionId: row.currentVersionId,
            sizeBytes: row.sizeBytes,
            sniffedContentType: row.sniffedContentType,
          })),
          nextCursor: page.nextCursor,
        } as z.infer<typeof DeletedFileListResponse>,
        200,
      );
    },
  );

  // POST /api/v1/files/{id}/restore — undelete, into the stored folder / a chosen one / the root
  app.openapi(
    {
      ...restoreFileRoute,
      middleware: chokepointMiddleware(chokepoint, restoreFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const now = () => new Date().toISOString();
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const restored = await restoreFile(
              firm.firmDatabase,
              id,
              { clock: { now }, actorUserId: userId },
              body.folderId === undefined ? {} : { folderId: body.folderId },
            );
            return {
              write: restored.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ fileId: id, folderId: restored.folderId }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
        const responseBody = JSON.parse(storedResponseBody(result)) as z.infer<
          typeof RestoredFileAck
        >;
        return c.json(responseBody, 200);
      } catch (caught) {
        if (caught instanceof FileManagerValidationError) return fileErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/files/{id}/archive-entries — Browse Inside a zip, central directory only
  app.openapi(
    {
      ...archiveEntriesRoute,
      middleware: chokepointMiddleware(chokepoint, archiveEntriesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      // Deliberately NOT loadVisibleFile: a soft-deleted zip browses exactly like a live one
      // (browsing reads the already-committed bytes and restores nothing), so the read keeps the
      // deleted row and only the version's clean gate decides whether there are bytes.
      const file = await getFileWithArchiveVersion(firm.firmDatabase, id);
      if (file === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file in this firm.",
        });
      }
      if (file.currentVersion === null) {
        return problemJson(c, {
          type: "conflict",
          title: "File has no committed bytes",
          status: 409,
          detail:
            "This file has no committed version yet, so there are no bytes to read inside — try " +
            "again once the upload finishes processing.",
        });
      }
      const caps = await readArchiveCaps(firm.firmDatabase);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      // WHICH ARCHIVE THIS IS, ASKED OF THE BYTES. The stored name and the type sniffed at ingest
      // are both claims made about the object; the format's own signature is the object itself. One
      // small ranged read settles it, and it is what lets a zip named `.dat` open and a text file
      // named `.zip` be refused as what it is.
      const headObject = await bucket.get(file.currentVersion.r2Key, {
        range: { offset: 0, length: ARCHIVE_SNIFF_BYTES },
      });
      if (headObject === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "The file's stored bytes are no longer available.",
        });
      }
      const format = archiveFormatOf(new Uint8Array(await headObject.arrayBuffer()));
      if (format === null) {
        return problemJson(c, {
          type: "not-an-archive",
          title: "Not an archive",
          status: 422,
          detail:
            "This file is not an archive this application can read, so it has nothing to browse.",
        });
      }
      try {
        const listing = await readArchiveContents(
          format,
          bucket,
          file.currentVersion.r2Key,
          { maxEntries: caps.maxEntries },
          ARCHIVE_ENGINES,
        );
        if (listing === null) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "The file's stored bytes are no longer available.",
          });
        }
        return c.json(
          {
            // The locator each member carries is how the extractor finds its bytes and is nobody
            // else's business — it never crosses the wire.
            entries: listing.members.map((member) => ({
              path: member.path,
              isDirectory: member.isDirectory,
              compressedSizeBytes: member.compressedSizeBytes,
              uncompressedSizeBytes: member.uncompressedSizeBytes,
              modifiedAt: member.modifiedAt,
            })),
            truncated: listing.truncated,
          } as z.infer<typeof ArchiveEntriesResponse>,
          200,
        );
      } catch (caught) {
        // A deployment with no 7z engine wired. A fact about this application and not about the
        // file, so it is named rather than reported as an unreadable archive.
        if (caught instanceof SevenZipEngineUnavailableError) {
          return problemJson(c, {
            type: "archive-unreadable",
            title: "Archive contents not readable",
            status: 422,
            detail:
              "Reading what is inside a 7z archive is not available on this deployment. The " +
              "archive can still be downloaded.",
          });
        }
        // A 7z the engine would not list. Some of those are statements about the archive and some
        // are statements about this application, and they are not the same fact — see
        // `sevenZipRefusal`, which is where the two are told apart.
        if (caught instanceof SevenZipListingError) {
          const refusal = sevenZipRefusal(caught);
          if (refusal !== null) {
            return problemJson(c, {
              type: refusal.type,
              title: "Archive contents not readable",
              status: 422,
              detail: refusal.detail,
            });
          }
          return problemJson(c, {
            type: "not-an-archive",
            title: "Not an archive",
            status: 422,
            detail: "This file's content is not a readable 7z archive.",
          });
        }
        // Bytes that carry a zip name or declared type but no readable zip end structures: not an
        // archive as far as browsing is concerned, and the caller can act on that — never a 500.
        if (caught instanceof ZipCentralDirectoryError) {
          return problemJson(c, {
            type: "not-an-archive",
            title: "Not an archive",
            status: 422,
            detail: "This file's content is not a readable zip archive.",
          });
        }
        throw caught;
      }
    },
  );

  // POST /api/v1/files/{id}/archive-extractions — take named members out and file them on the matter
  app.openapi(
    {
      ...extractArchiveMembersRoute,
      middleware: chokepointMiddleware(chokepoint, extractArchiveMembersRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      // The SAME resolution the listing uses, and deliberately NOT loadVisibleFile: a soft-deleted
      // zip is a valid source. Taking a member out of one files that member into the LIVE matter and
      // leaves the archive deleted — what was deleted was the container, not the ability to produce
      // what a person can show was inside it.
      const file = await getFileWithArchiveVersion(firm.firmDatabase, id);
      if (file === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file in this firm.",
        });
      }
      const archiveVersion = file.currentVersion;
      if (archiveVersion === null) {
        return problemJson(c, {
          type: "conflict",
          title: "File has no committed bytes",
          status: 409,
          detail:
            "This file has no committed version yet, so there is nothing inside it to extract — " +
            "try again once the upload finishes processing.",
        });
      }
      const caps = await readArchiveCaps(firm.firmDatabase);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      // ASKED OF THE BYTES, exactly as the listing asks — the stored name and the type sniffed at
      // ingest are both claims about the object, and a member is about to be taken out of it and
      // filed on the matter on the strength of the answer.
      const formatHead = await bucket.get(archiveVersion.r2Key, {
        range: { offset: 0, length: ARCHIVE_SNIFF_BYTES },
      });
      if (formatHead === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "The file's stored bytes are no longer available.",
        });
      }
      const archiveFormat = archiveFormatOf(new Uint8Array(await formatHead.arrayBuffer()));
      if (archiveFormat === null) {
        return problemJson(c, {
          type: "not-an-archive",
          title: "Not an archive",
          status: 422,
          detail: "This file is not an archive, so it has nothing to extract.",
        });
      }
      // A real archive whose members this platform can list and cannot take out. Two different
      // facts, said differently: browsing one works, and the refusal names the format rather than
      // claiming the file has nothing in it — which the person can see on screen is false.
      const extractability = archiveExtractability(archiveFormat, ARCHIVE_ENGINES);
      if (extractability.kind === "refused") {
        return problemJson(c, {
          type: "archive-unreadable",
          title: "Archive members cannot be taken out",
          status: 422,
          detail:
            extractability.reason === "format-not-extractable"
              ? `This is a ${archiveFormatName(archiveFormat)} archive. What is inside it can be ` +
                "browsed, but taking a member out of one is not something this application can " +
                "do — download the archive to open it."
              : `Taking a member out of a ${archiveFormatName(archiveFormat)} archive is not ` +
                "available on this deployment. The archive can still be downloaded.",
        });
      }
      let contents;
      try {
        contents = await readArchiveContents(
          archiveFormat,
          bucket,
          archiveVersion.r2Key,
          { maxEntries: caps.maxEntries },
          ARCHIVE_ENGINES,
        );
      } catch (caught) {
        if (caught instanceof ZipCentralDirectoryError) {
          return problemJson(c, {
            type: "not-an-archive",
            title: "Not an archive",
            status: 422,
            detail: "This file's content is not a readable zip archive.",
          });
        }
        if (
          caught instanceof SevenZipEngineUnavailableError ||
          caught instanceof SevenZipListingError
        ) {
          return problemJson(c, {
            type: "archive-unreadable",
            title: "Archive contents not readable",
            status: 422,
            detail:
              "What is inside this archive could not be read, so there is nothing to take out of " +
              "it. The archive can still be downloaded.",
          });
        }
        throw caught;
      }
      if (contents === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "The file's stored bytes are no longer available.",
        });
      }
      // The listing is the ONLY source of what a requested path means: each member carries the
      // locator its own format's extractor works from. A path the listing does not hold is refused
      // by name rather than searched for by hand.
      const extraction = new ArchiveExtraction(
        bucket,
        archiveVersion.r2Key,
        contents,
        {
          maxUncompressedBytes: caps.maxUncompressedBytes,
          maxExpansionRatio: caps.maxExpansionRatio,
          // A TOTAL across the request, not just the firm's per-member ceiling: a hundred members that
          // each pass individually are still a hundred times that ceiling held in one isolate.
          requestBudgetBytes: caps.maxUncompressedBytes,
        },
        ARCHIVE_ENGINES,
      );

      const extracted: z.infer<typeof ExtractedArchiveMember>[] = [];
      const refused: z.infer<typeof RefusedArchiveMember>[] = [];
      // Every decision below the request — which member may be taken, what it is allowed to produce,
      // what the request has spent so far, and why each refusal happened — belongs to the extraction
      // session. This loop asks it for bytes and files what comes back. The request still answers
      // 202 whatever the mix: a refusal is a fact about a member, not a failed request.
      for (const [index, path] of body.paths.entries()) {
        if (!extraction.holds(path)) {
          refused.push({ path, reason: "not-in-archive" });
          continue;
        }
        const taken = await extraction.take(path);
        if (taken.kind === "refused") {
          refused.push({ path, reason: taken.reason });
          continue;
        }
        const name = extractedMemberName(path, index);
        try {
          const filed = await fileExtractedMember(c, {
            bytes: taken.bytes,
            name,
            // ALWAYS the archive's own matter, never a matter from the request.
            matterId: file.matterId,
            folderId: body.folderId ?? null,
            sourceModifiedAt: taken.member.modifiedAt,
            archiveFileId: id,
            archivePath: path,
          });
          extracted.push({ path, name, ...filed });
        } catch (caught) {
          if (caught instanceof FileManagerValidationError) {
            // The firm's upload policy refusing this member's size or its name is a fact about the
            // member, exactly like an encrypted one — the other members still go through. It is
            // recorded on the session as well as answered, so the accounting of what this request
            // did holds every refusal rather than only the ones the archive itself caused.
            const policyRefusal: ArchiveExtractionRefusal | null =
              caught.code === "upload-policy-size"
                ? "too-large"
                : caught.code === "upload-policy-type"
                  ? "unsupported-compression"
                  : null;
            if (policyRefusal !== null) {
              extraction.recordExternalRefusal(path, policyRefusal);
            }
            if (caught.code === "upload-policy-size") {
              refused.push({ path, reason: "policy-size" });
              continue;
            }
            if (caught.code === "upload-policy-type") {
              refused.push({ path, reason: "policy-type" });
              continue;
            }
            // The destination folder, by contrast, is a fact about the REQUEST: it is the same for
            // every member, so it fails on the first one with nothing yet committed, and the honest
            // answer is the reserved absence rather than a hundred identical refusals.
            if (caught.code === "unknown-folder" || caught.code === "file-cross-matter") {
              return problemJson(c, {
                type: "not-found",
                title: "Not found",
                status: 404,
                detail: "No such folder in this matter.",
              });
            }
          }
          throw caught;
        }
      }
      return c.json({ extracted, refused }, 202);
    },
  );

  // GET /api/v1/matters/{matterId}/file-history — the matter's file activity trail
  app.openapi(
    {
      ...fileHistoryRoute,
      middleware: chokepointMiddleware(chokepoint, fileHistoryRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { cursor, pageSize } = c.req.valid("query");
      const page = await listFileHistory(firm.firmDatabase, matterId, {
        ...(cursor === undefined ? {} : { cursor }),
        ...(pageSize === undefined ? {} : { pageSize }),
      });
      // The stored metadata is redacted JSON written by this platform; parse it back into the object
      // the writer recorded. A row that carried none passes through as null.
      const rows = page.data.map((row) => ({
        row,
        metadata: row.metadataJson === null ? null : (JSON.parse(row.metadataJson) as unknown),
      }));
      // Resolve the ids the page's metadata references into display text — two bounded reads at
      // most, each skipped when no entry on the page needs it. Folder ids resolve against the
      // matter's CURRENT tree; a recorded folder that no longer exists renders its honest fallback.
      const changeInputs = rows.map(({ row, metadata }) => ({
        event: row.event,
        versionNumber: row.versionNumber,
        metadata,
      }));
      const folderText = anyEntryReferencesAFolder(changeInputs)
        ? folderTextResolver(await listFoldersByMatter(firm.firmDatabase, matterId))
        : folderTextResolver([]);
      const referencedTypeIds = collectReferencedDocumentTypeIds(changeInputs);
      const documentTypeNames =
        referencedTypeIds.length === 0
          ? new Map<string, string>()
          : await listDocumentTypeNamesByIds(
              firm.firmDatabase,
              referencedTypeIds as DocumentTypeId[],
            );
      return c.json(
        {
          data: rows.map(({ row, metadata }, index) => {
            const changeInput = changeInputs[index];
            const { fromText, toText } =
              changeInput === undefined
                ? { fromText: null, toText: null }
                : resolveHistoryChangeTexts(changeInput, {
                    folderText,
                    documentTypeName: (documentTypeId) =>
                      documentTypeNames.get(documentTypeId as DocumentTypeId) ?? null,
                  });
            return {
              at: row.at,
              event: row.event,
              subjectKind: row.subjectKind,
              subjectId: row.subjectId,
              subjectName: row.subjectName,
              versionNumber: row.versionNumber,
              actorUserId: row.actorUserId,
              actorName: row.actorName,
              detail: metadata,
              fromText,
              toText,
            };
          }),
          nextCursor: page.nextCursor,
        } as z.infer<typeof FileHistoryResponse>,
        200,
      );
    },
  );
}

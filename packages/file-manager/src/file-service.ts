import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";
import { fileAuditStatement, type AuditContext } from "./audit.ts";
import {
  abandonVersionStatement,
  assignDocumentTypeStatement,
  BULK_PREFIX,
  bumpFileCurrentVersionStatement,
  commitVersionStatement,
  fileVersionKey,
  FILES_PREFIX,
  insertFileStatement,
  insertFileVersionStatement,
  insertUploadSessionStatement,
  moveFileStatement,
  quarantineVersionStatement,
  renameFileStatement,
  selectCurrentVersionHashStatement,
  selectFileStatement,
  selectMaxVersionNumberStatement,
  selectPendingVersionByR2KeyStatement,
  selectPendingVersionStatement,
  selectUploadSessionStatement,
  setUploadSessionStatusByIdStatement,
  setUploadSessionStatusStatement,
  softDeleteFileStatement,
} from "./file-statements.ts";
import { selectFolderStatement } from "./folder-statements.ts";
import { meterCommitStatements } from "./metering-statements.ts";
import { recordScanCacheStatement } from "./scan-cache.ts";
import { checkUploadPolicy, readUploadPolicy } from "./upload-policy.ts";
import { FileManagerValidationError } from "./validation.ts";

export type FileServiceOptions = AuditContext;

interface StoredFile {
  readonly id: FileId;
  readonly matterId: MatterId;
  readonly folderId: FolderId | null;
  readonly currentVersionId: FileVersionId | null;
  readonly deletedAt: string | null;
}

async function loadFile(database: SqlDatabase, id: FileId): Promise<StoredFile | undefined> {
  const { results } = await selectFileStatement(database, id).all<{
    id: FileId;
    matter_id: MatterId;
    folder_id: FolderId | null;
    current_version_id: FileVersionId | null;
    deleted_at: string | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    matterId: row.matter_id,
    folderId: row.folder_id,
    currentVersionId: row.current_version_id,
    deletedAt: row.deleted_at,
  };
}

async function requireFile(database: SqlDatabase, id: FileId): Promise<StoredFile> {
  const file = await loadFile(database, id);
  if (file === undefined) {
    throw new FileManagerValidationError("unknown-file", `no such file: ${id}`);
  }
  return file;
}

// The matter a folder belongs to (undefined when the folder is unknown) — the same-matter guard the
// file moves and uploads enforce so a file never lands in a folder of another matter.
async function loadFolderMatter(
  database: SqlDatabase,
  folderId: FolderId,
): Promise<MatterId | undefined> {
  const { results } = await selectFolderStatement(database, folderId).all<{
    matter_id: MatterId;
  }>();
  return results[0]?.matter_id;
}

export interface InitiateUploadInput {
  readonly matterId: MatterId;
  readonly folderId?: FolderId | null;
  readonly name: string;
  readonly declaredSize: number | null;
  readonly declaredContentType: string | null;
  readonly uploadedBy: UserId | null;
  readonly mode: "put" | "multipart";
  readonly documentTypeId?: DocumentTypeId | null;
  readonly fileId?: FileId; // present = a new version on an existing file
  readonly expiresAt?: string | null;
  // Absent or "interactive" = the file lands in the interactive ingest lane (files/ key prefix);
  // "bulk" = the file lands in the bulk ingest lane (bulk/ key prefix, lower queue concurrency).
  readonly uploadKind?: "interactive" | "bulk";
}

export interface InitiatedUpload {
  readonly fileId: FileId;
  readonly versionId: FileVersionId;
  readonly versionNumber: number;
  readonly r2Key: string;
  readonly uploadSessionId: string;
  readonly effect: EffectWrite;
}

// Composes the pending file (or a new pending version on an existing file), the pending file_version,
// and the open upload_session. Re-checks the per-firm policy against the DECLARED size/type — the
// gate re-checks the real bytes. The bytes never transit here; the route mints the presigned URL.
export async function initiateUpload(
  database: SqlDatabase,
  input: InitiateUploadInput,
  options: FileServiceOptions,
): Promise<InitiatedUpload> {
  const policy = await readUploadPolicy(database);
  checkUploadPolicy(policy, {
    sizeBytes: input.declaredSize,
    contentType: input.declaredContentType,
    fileName: input.name,
  });

  const statements: EffectWrite["statements"][number][] = [];
  let fileId: FileId;
  let versionNumber: number;
  if (input.fileId !== undefined) {
    const existing = await requireFile(database, input.fileId);
    // A new version rides the existing file's matter; a payload claiming a different matter is a
    // mismatch (the folder/document-type fields below are validated against that same matter).
    if (existing.matterId !== input.matterId) {
      throw new FileManagerValidationError(
        "file-matter-mismatch",
        "the target file belongs to a different matter",
      );
    }
    if (input.folderId !== undefined && input.folderId !== null) {
      const folderMatterId = await loadFolderMatter(database, input.folderId);
      if (folderMatterId === undefined) {
        throw new FileManagerValidationError("unknown-folder", `no such folder: ${input.folderId}`);
      }
      if (folderMatterId !== input.matterId) {
        throw new FileManagerValidationError(
          "file-cross-matter",
          "a file's folder must belong to the same matter",
        );
      }
    }
    fileId = input.fileId;
    const { results } = await selectMaxVersionNumberStatement(database, fileId).all<{
      n: number;
    }>();
    versionNumber = (results[0]?.n ?? 0) + 1;
  } else {
    fileId = newIdentifier("file", options.randomSource);
    versionNumber = 1;
    statements.push(
      insertFileStatement(database, {
        id: fileId,
        matterId: input.matterId,
        folderId: input.folderId ?? null,
        name: input.name,
        documentTypeId: input.documentTypeId ?? null,
        createdAt: options.clock.now(),
      }),
    );
  }
  const versionId = newIdentifier("fileVersion", options.randomSource);
  const uploadSessionId = newIdentifier("uploadSession", options.randomSource);
  const prefix = input.uploadKind === "bulk" ? BULK_PREFIX : FILES_PREFIX;
  const r2Key = fileVersionKey(fileId, versionId, prefix);
  statements.push(
    insertFileVersionStatement(database, {
      id: versionId,
      fileId,
      versionNumber,
      r2Key,
      declaredContentType: input.declaredContentType,
      uploadedBy: input.uploadedBy,
      createdAt: options.clock.now(),
    }),
    insertUploadSessionStatement(database, {
      id: uploadSessionId,
      fileVersionId: versionId,
      mode: input.mode,
      declaredSize: input.declaredSize,
      declaredContentType: input.declaredContentType,
      createdAt: options.clock.now(),
      expiresAt: input.expiresAt ?? null,
    }),
    fileAuditStatement(database, options, "file.upload_initiated", versionId),
  );
  return {
    fileId,
    versionId,
    versionNumber,
    r2Key,
    uploadSessionId,
    effect: { statements, outboxMessages: [] },
  };
}

interface PendingVersion {
  readonly id: FileVersionId;
  readonly fileId: FileId;
  readonly versionNumber: number;
}

async function loadPendingVersion(
  database: SqlDatabase,
  versionId: FileVersionId,
): Promise<PendingVersion | undefined> {
  const { results } = await selectPendingVersionStatement(database, versionId).all<{
    id: FileVersionId;
    file_id: FileId;
    version_number: number;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return { id: row.id, fileId: row.file_id, versionNumber: row.version_number };
}

// The facts the ingest pipeline needs about a pending version, found by its r2_key: the version id
// (to commit/quarantine), the declared size/type runIngest re-checks against the real bytes, and the
// file name the gate re-checks the extension blocklist against (the r2_key carries no extension).
export interface PendingIngestVersion {
  readonly id: FileVersionId;
  readonly declaredSize: number | null;
  readonly declaredContentType: string | null;
  readonly r2Key: string;
  readonly name: string;
}

export async function loadPendingVersionForIngest(
  database: SqlDatabase,
  r2Key: string,
): Promise<PendingIngestVersion | undefined> {
  const { results } = await selectPendingVersionByR2KeyStatement(database, r2Key).all<{
    id: FileVersionId;
    declared_content_type: string | null;
    r2_key: string;
    declared_size: number | null;
    file_name: string;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    declaredSize: row.declared_size,
    declaredContentType: row.declared_content_type,
    r2Key: row.r2_key,
    name: row.file_name,
  };
}

export interface CommitVersionInput {
  readonly versionId: FileVersionId;
  readonly sizeBytes: number;
  readonly sniffedContentType: string | null;
  readonly contentSha256: string;
  readonly scanVerdict: "unscanned" | "clean";
  readonly scanEngineVersion: string | null;
  readonly scanDetail: string | null;
  readonly now: string;
}

export interface CommittedVersion {
  readonly skipped: boolean;
  readonly fileId: FileId;
  readonly effect: EffectWrite;
}

// Commits a pending version to clean: writes the size/sniffed-type/hash/scan, promotes it to the
// file's current version, completes the session, and meters the bytes — all in one batch (idempotent
// on the status = 'pending' guard, so a replayed ingest no-ops). A re-upload of identical bytes is a
// no-op: the pending version is abandoned and nothing new is cut.
export async function commitVersion(
  database: SqlDatabase,
  input: CommitVersionInput,
  options: FileServiceOptions,
): Promise<CommittedVersion> {
  const version = await loadPendingVersion(database, input.versionId);
  if (version === undefined) {
    throw new FileManagerValidationError(
      "version-not-pending",
      `version is not pending (already committed, quarantined, or unknown): ${input.versionId}`,
    );
  }
  const { results } = await selectCurrentVersionHashStatement(database, version.fileId).all<{
    hash: string | null;
  }>();
  const currentHash = results[0]?.hash ?? null;
  if (currentHash !== null && currentHash === input.contentSha256) {
    return {
      skipped: true,
      fileId: version.fileId,
      effect: {
        statements: [
          abandonVersionStatement(database, input.versionId),
          setUploadSessionStatusStatement(database, input.versionId, "completed"),
          fileAuditStatement(database, options, "file.version_skipped", input.versionId),
        ],
        outboxMessages: [],
      },
    };
  }
  return {
    skipped: false,
    fileId: version.fileId,
    effect: {
      statements: [
        commitVersionStatement(database, {
          versionId: input.versionId,
          sizeBytes: input.sizeBytes,
          sniffedContentType: input.sniffedContentType,
          contentSha256: input.contentSha256,
          scanVerdict: input.scanVerdict,
          scanEngineVersion: input.scanEngineVersion,
          scanDetail: input.scanDetail,
          committedAt: input.now,
        }),
        bumpFileCurrentVersionStatement(database, version.fileId, input.versionId, input.now),
        setUploadSessionStatusStatement(database, input.versionId, "completed"),
        ...meterCommitStatements(
          database,
          { storageClass: "standard", artifactRole: "original", prefix: FILES_PREFIX },
          input.sizeBytes,
        ),
        fileAuditStatement(database, options, "file.version_committed", input.versionId),
        // Populate the content-dedup cache (scan-once) atomically with the commit — but ONLY for a
        // definitive CLEAN verdict from a real engine. `unscanned`/no-engine commits (the launch
        // adapter, or a missing engine version) are never cached, so a later re-scan still runs the
        // engine; an `infected` outcome never reaches commit (it quarantines).
        ...(input.scanVerdict === "clean" &&
        input.scanEngineVersion !== null &&
        input.contentSha256 !== null
          ? [
              recordScanCacheStatement(database, {
                contentSha256: input.contentSha256,
                engineVersion: input.scanEngineVersion,
                verdict: "clean",
                signature: null,
                scannedAt: input.now,
              }),
            ]
          : []),
      ],
      outboxMessages: [
        {
          topic: "file.version_committed",
          payload: { fileId: version.fileId, versionId: input.versionId },
        },
      ],
    },
  };
}

export async function quarantineVersion(
  database: SqlDatabase,
  input: { versionId: FileVersionId; reason: string; scanDetail: string | null },
  options: FileServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const version = await loadPendingVersion(database, input.versionId);
  if (version === undefined) {
    throw new FileManagerValidationError(
      "version-not-pending",
      `version is not pending: ${input.versionId}`,
    );
  }
  return {
    effect: {
      statements: [
        quarantineVersionStatement(database, input.versionId, input.scanDetail),
        fileAuditStatement(database, options, "file.quarantined", input.versionId),
      ],
      outboxMessages: [
        {
          topic: "file.quarantined",
          payload: { versionId: input.versionId, reason: input.reason },
        },
      ],
    },
  };
}

export async function renameFile(
  database: SqlDatabase,
  fileId: FileId,
  name: string,
  options: FileServiceOptions,
): Promise<{ effect: EffectWrite }> {
  await requireFile(database, fileId);
  return {
    effect: {
      statements: [
        renameFileStatement(database, fileId, name, options.clock.now()),
        fileAuditStatement(database, options, "file.renamed", fileId),
      ],
      outboxMessages: [],
    },
  };
}

export async function moveFile(
  database: SqlDatabase,
  fileId: FileId,
  folderId: FolderId | null,
  options: FileServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const file = await requireFile(database, fileId);
  if (folderId !== null) {
    // The target folder must live in the file's matter — a file never crosses matters on a move.
    const folderMatterId = await loadFolderMatter(database, folderId);
    if (folderMatterId === undefined) {
      throw new FileManagerValidationError("unknown-folder", `no such folder: ${folderId}`);
    }
    if (folderMatterId !== file.matterId) {
      throw new FileManagerValidationError(
        "file-cross-matter",
        "a file's target folder must belong to the same matter",
      );
    }
  }
  return {
    effect: {
      statements: [
        moveFileStatement(database, fileId, folderId, options.clock.now()),
        fileAuditStatement(database, options, "file.moved", fileId),
      ],
      outboxMessages: [],
    },
  };
}

export async function assignDocumentType(
  database: SqlDatabase,
  fileId: FileId,
  documentTypeId: DocumentTypeId | null,
  options: FileServiceOptions,
): Promise<{ effect: EffectWrite }> {
  await requireFile(database, fileId);
  return {
    effect: {
      statements: [
        assignDocumentTypeStatement(database, fileId, documentTypeId, options.clock.now()),
        fileAuditStatement(database, options, "file.document_type_assigned", fileId),
      ],
      outboxMessages: [],
    },
  };
}

export async function softDeleteFile(
  database: SqlDatabase,
  fileId: FileId,
  options: FileServiceOptions,
): Promise<{ effect: EffectWrite }> {
  await requireFile(database, fileId);
  return {
    effect: {
      statements: [
        softDeleteFileStatement(database, fileId, options.clock.now()),
        fileAuditStatement(database, options, "file.deleted", fileId),
      ],
      outboxMessages: [],
    },
  };
}

// The open upload session joined to its version's r2 key — what the upload routes read to sign parts,
// complete, or abort (they hold the session id, never the version id or key).
export interface UploadSessionRecord {
  readonly id: UploadSessionId;
  readonly fileVersionId: FileVersionId;
  readonly mode: "put" | "multipart";
  readonly r2UploadId: string | null;
  readonly status: "open" | "completed" | "aborted" | "expired";
  readonly declaredContentType: string | null;
  readonly r2Key: string;
}

export async function loadUploadSession(
  database: SqlDatabase,
  sessionId: UploadSessionId,
): Promise<UploadSessionRecord | undefined> {
  const { results } = await selectUploadSessionStatement(database, sessionId).all<{
    id: UploadSessionId;
    file_version_id: FileVersionId;
    mode: "put" | "multipart";
    r2_upload_id: string | null;
    status: "open" | "completed" | "aborted" | "expired";
    declared_content_type: string | null;
    r2_key: string;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    fileVersionId: row.file_version_id,
    mode: row.mode,
    r2UploadId: row.r2_upload_id,
    status: row.status,
    declaredContentType: row.declared_content_type,
    r2Key: row.r2_key,
  };
}

async function requireOpenSession(
  database: SqlDatabase,
  sessionId: UploadSessionId,
): Promise<UploadSessionRecord> {
  const session = await loadUploadSession(database, sessionId);
  if (session === undefined) {
    throw new FileManagerValidationError(
      "unknown-upload-session",
      `no such upload session: ${sessionId}`,
    );
  }
  if (session.status !== "open") {
    throw new FileManagerValidationError(
      "upload-session-not-open",
      `upload session is ${session.status}, not open: ${sessionId}`,
    );
  }
  return session;
}

// Closes an open session: the bytes are in R2 (single-shot PUT done, or multipart completed). The
// version stays 'pending' — ingest (the queue consumer over the R2 event) commits or quarantines it.
export async function completeUploadSession(
  database: SqlDatabase,
  sessionId: UploadSessionId,
  options: FileServiceOptions,
): Promise<{ session: UploadSessionRecord; effect: EffectWrite }> {
  const session = await requireOpenSession(database, sessionId);
  return {
    session,
    effect: {
      statements: [
        setUploadSessionStatusByIdStatement(database, sessionId, "completed"),
        fileAuditStatement(database, options, "file.upload_completed", session.fileVersionId),
      ],
      outboxMessages: [],
    },
  };
}

// Aborts an open session and abandons its pending version. Returns the R2 coordinates so the route
// can abort the multipart upload at R2 (a single-shot PUT has none).
export async function abortUploadSession(
  database: SqlDatabase,
  sessionId: UploadSessionId,
  options: FileServiceOptions,
): Promise<{
  mode: "put" | "multipart";
  r2Key: string;
  r2UploadId: string | null;
  effect: EffectWrite;
}> {
  const session = await requireOpenSession(database, sessionId);
  return {
    mode: session.mode,
    r2Key: session.r2Key,
    r2UploadId: session.r2UploadId,
    effect: {
      statements: [
        setUploadSessionStatusByIdStatement(database, sessionId, "aborted"),
        abandonVersionStatement(database, session.fileVersionId),
        fileAuditStatement(database, options, "file.upload_aborted", session.fileVersionId),
      ],
      outboxMessages: [],
    },
  };
}

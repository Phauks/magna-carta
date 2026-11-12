import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DocumentCheckoutId,
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  matterScopedObjectDimensions,
  type ObjectDimensions,
} from "@magna-carta/object-dimensions/dimensions";
import { fileAuditStatement, type AuditContext } from "./audit.ts";
import {
  DOCUMENT_CHECKED_IN_TOPIC,
  DOCUMENT_CHECKIN_CONFLICT_TOPIC,
  FILE_QUARANTINED_TOPIC,
  FILE_RESCAN_INFECTED_TOPIC,
  FILE_VERSION_COMMITTED_TOPIC,
} from "./topics.ts";
import { getCheckoutById, setCheckoutStatusStatement } from "./checkout-statements.ts";
import {
  abandonVersionStatement,
  assertVersionStatusStatement,
  assignDocumentTypeStatement,
  BULK_PREFIX,
  bumpFileCurrentVersionStatement,
  clearCurrentObjectStatement,
  commitVersionStatement,
  fileVersionKey,
  FILES_PREFIX,
  insertFileStatement,
  insertFileVersionStatement,
  insertUploadSessionStatement,
  markVersionConflictStatement,
  moveFileStatement,
  quarantineCommittedVersionStatement,
  quarantineVersionStatement,
  renameFileStatement,
  repointCurrentVersionAfterWithdrawalStatement,
  rescanVerdictStatement,
  restoreFileStatement,
  selectCleanVersionByIdStatement,
  countOtherVersionsHoldingBytesStatement,
  selectCleanVersionFactsStatement,
  selectVersionObjectsOfFileStatement,
  selectCurrentVersionHashStatement,
  selectFileStatement,
  selectMaxVersionNumberStatement,
  selectPendingVersionByR2KeyStatement,
  selectPendingVersionStatement,
  selectUploadSessionStatement,
  setUploadSessionStatusByIdStatement,
  setUploadSessionStatusStatement,
  softDeleteFileStatement,
  insertVersionParticipantStatements,
  type VersionSaveKind,
} from "./file-statements.ts";
import { selectFolderStatement } from "./folder-statements.ts";
import { meterCommitStatements } from "./metering-statements.ts";
import type { RawScanResult } from "./scan-port.ts";
import { recordScanCacheStatement } from "./scan-cache.ts";
import {
  checkUploadPolicy,
  readUploadPolicy,
  scanEngineVersionDefinition,
} from "./upload-policy.ts";
import { FileManagerValidationError } from "./validation.ts";

export type FileServiceOptions = AuditContext;

interface StoredFile {
  readonly id: FileId;
  readonly matterId: MatterId;
  readonly folderId: FolderId | null;
  readonly currentVersionId: FileVersionId | null;
  readonly currentR2Key: string | null;
  readonly deletedAt: string | null;
}

async function loadFile(database: SqlDatabase, id: FileId): Promise<StoredFile | undefined> {
  const { results } = await selectFileStatement(database, id).all<{
    id: FileId;
    matter_id: MatterId;
    folder_id: FolderId | null;
    current_version_id: FileVersionId | null;
    current_r2_key: string | null;
    deleted_at: string | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    matterId: row.matter_id,
    folderId: row.folder_id,
    currentVersionId: row.current_version_id,
    currentR2Key: row.current_r2_key,
    deletedAt: row.deleted_at,
  };
}

// Resolves a file whatever its deleted state. Only the recovery surface wants this — an undelete has
// to find the row precisely because it is soft-deleted. Every other caller wants requireLiveFile.
async function requireFileIncludingDeleted(database: SqlDatabase, id: FileId): Promise<StoredFile> {
  const file = await loadFile(database, id);
  if (file === undefined) {
    throw new FileManagerValidationError("unknown-file", `no such file: ${id}`);
  }
  return file;
}

// Resolves a file that is still live — the default for every write path. A soft-deleted file refuses
// its mutations: `deleted_at` is the visibility gate every consumer read filters on (queries.ts), so a
// rename, a move, a document-type assignment, or a new version applied to a deleted row is a change
// nobody can observe until an undelete resurrects a file that quietly moved while it was gone. The
// refusal carries its own code but the routes map it to the same not-found response an unknown file
// gets, so a mutation never becomes the one path that confirms a deleted file still exists.
async function requireLiveFile(database: SqlDatabase, id: FileId): Promise<StoredFile> {
  const file = await requireFileIncludingDeleted(database, id);
  if (file.deletedAt !== null) {
    throw new FileManagerValidationError("file-deleted", `file is deleted: ${id}`);
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
  // The last-modified instant the reader's device reported for the source file, ISO-8601. Recorded on
  // the version as a fact about where the bytes came from, whichever way the file is dated.
  readonly sourceModifiedAt?: string | null;
  // How a NEW file is dated. "upload" (the default) records the file as created at the instant of
  // this reservation; "source" records it as created when the source file was last modified, so a
  // document that carries a date of its own keeps it. Ignored for a new version of an existing file,
  // whose creation is already a fact. Never later than now: a device clock running ahead cannot file
  // a document in the future.
  readonly createdAtBasis?: "upload" | "source";
}

export interface InitiatedUpload {
  readonly fileId: FileId;
  readonly versionId: FileVersionId;
  readonly versionNumber: number;
  readonly r2Key: string;
  readonly uploadSessionId: string;
  // The object metadata the bytes must be written with, minted here because this is where the matter
  // is known. Every caller — the presigned PUT, the multipart create, and the paths that write the
  // bytes themselves — passes this through unchanged rather than rebuilding it, so an object's scope
  // is decided once per version and cannot differ by upload route.
  readonly dimensions: ObjectDimensions;
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

  // A file's folder (when given) must belong to the target matter — enforced for BOTH a new file and a
  // new version of an existing file, so a file can never be parented under another matter's folder
  // (an unknown folder is a clean validation error, not an FK-violating insert).
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

  let fileId: FileId;
  let versionNumber: number;
  // The folder the version lands in, recorded on the audit row (ids only, redact-by-default) so the
  // history can place the upload without a read the trail cannot afford later. Known cheaply here:
  // the caller named it for a new file, and the loaded row carries it for a new version.
  let auditFolderId: FolderId | null;
  const now = options.clock.now();
  const sourceModifiedAt = validSourceInstant(input.sourceModifiedAt);
  const fileCreatedAt = recordedCreationInstant(input.createdAtBasis, sourceModifiedAt, now);
  if (input.fileId !== undefined) {
    const existing = await requireLiveFile(database, input.fileId);
    auditFolderId = existing.folderId;
    // A new version rides the existing file's matter; a payload claiming a different matter is a
    // mismatch (the folder is validated against that same matter above).
    if (existing.matterId !== input.matterId) {
      throw new FileManagerValidationError(
        "file-matter-mismatch",
        "the target file belongs to a different matter",
      );
    }
    fileId = input.fileId;
    const { results } = await selectMaxVersionNumberStatement(database, fileId).all<{
      n: number;
    }>();
    versionNumber = (results[0]?.n ?? 0) + 1;
  } else {
    fileId = newIdentifier("file", options.randomSource);
    versionNumber = 1;
    auditFolderId = input.folderId ?? null;
    statements.push(
      insertFileStatement(database, {
        id: fileId,
        matterId: input.matterId,
        folderId: input.folderId ?? null,
        name: input.name,
        documentTypeId: input.documentTypeId ?? null,
        createdAt: fileCreatedAt,
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
      createdAt: now,
      sourceModifiedAt,
    }),
    insertUploadSessionStatement(database, {
      id: uploadSessionId,
      fileVersionId: versionId,
      mode: input.mode,
      declaredSize: input.declaredSize,
      declaredContentType: input.declaredContentType,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
    }),
    fileAuditStatement(database, options, "file.upload_initiated", versionId, {
      folderId: auditFolderId,
    }),
  );
  return {
    fileId,
    versionId,
    versionNumber,
    r2Key,
    uploadSessionId,
    dimensions: matterScopedObjectDimensions({
      objectClass: "working-document",
      matterId: input.matterId,
    }),
    effect: { statements, outboxMessages: [] },
  };
}

// The source instant as the record keeps it, or null when the client sent none or sent something that
// is not an instant. Normalised to the platform's own ISO-8601 UTC spelling so it compares
// lexicographically with every other timestamp in the firm's database.
function validSourceInstant(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) return null;
  return new Date(milliseconds).toISOString();
}

// When a new file is recorded as created. The source date only when the caller asked for it AND the
// device reported one; and never after now, because a document filed in the future sorts ahead of
// everything the firm does today and reads as a record of something that has not happened.
function recordedCreationInstant(
  basis: "upload" | "source" | undefined,
  sourceModifiedAt: string | null,
  now: string,
): string {
  if (basis !== "source" || sourceModifiedAt === null) return now;
  return sourceModifiedAt < now ? sourceModifiedAt : now;
}

export interface InitiateCheckinInput {
  readonly fileId: FileId;
  readonly checkoutId: DocumentCheckoutId;
  readonly declaredSize: number | null;
  readonly declaredContentType: string | null;
  readonly uploadedBy: UserId;
  readonly expiresAt?: string | null;
}

export interface InitiatedCheckin {
  readonly versionId: FileVersionId;
  readonly versionNumber: number;
  readonly r2Key: string;
  readonly uploadSessionId: string;
  // The returning bytes are a version of an existing file, so they carry that file's matter — read
  // from the file row this function already loaded rather than taken from the caller.
  readonly dimensions: ObjectDimensions;
  readonly effect: EffectWrite;
}

// Mints the return leg of an offline checkout: a new pending file_version on the existing file carrying
// the checkout id, plus an open upload_session so the ingest gate (which keys off the session for the
// declared size and the file's name) processes the returning bytes exactly like any other upload — full
// scan, hash, and policy re-check on untrusted bytes. The bytes never transit here; the route mints a
// presigned PUT to the version's key. The cleared version routes through commitCheckinVersion
// (divergence-aware) rather than a plain commit. The caller validates the checkout before this runs.
// Version numbering mirrors initiateUpload (max over all statuses + 1, protected by the
// UNIQUE(file_id, version_number) slot) so a concurrent upload and check-in cannot reuse a number.
export async function initiateCheckin(
  database: SqlDatabase,
  input: InitiateCheckinInput,
  options: FileServiceOptions,
): Promise<InitiatedCheckin> {
  const file = await requireLiveFile(database, input.fileId);
  const { results } = await selectMaxVersionNumberStatement(database, input.fileId).all<{
    n: number;
  }>();
  const versionNumber = (results[0]?.n ?? 0) + 1;
  const versionId = newIdentifier("fileVersion", options.randomSource);
  const uploadSessionId = newIdentifier("uploadSession", options.randomSource);
  const r2Key = fileVersionKey(input.fileId, versionId);
  return {
    versionId,
    versionNumber,
    r2Key,
    uploadSessionId,
    dimensions: matterScopedObjectDimensions({
      objectClass: "working-document",
      matterId: file.matterId,
    }),
    effect: {
      statements: [
        insertFileVersionStatement(database, {
          id: versionId,
          fileId: input.fileId,
          versionNumber,
          r2Key,
          declaredContentType: input.declaredContentType,
          uploadedBy: input.uploadedBy,
          createdAt: options.clock.now(),
          checkoutId: input.checkoutId,
        }),
        insertUploadSessionStatement(database, {
          id: uploadSessionId,
          fileVersionId: versionId,
          mode: "put",
          declaredSize: input.declaredSize,
          declaredContentType: input.declaredContentType,
          createdAt: options.clock.now(),
          expiresAt: input.expiresAt ?? null,
        }),
        fileAuditStatement(database, options, "document.checkin_initiated", input.fileId),
      ],
      // Domain event — an offline working copy is being returned (the bytes follow via the presigned
      // PUT → quarantine ingest, which then commits/reconciles the version). Subscribers: audit, notify.
      outboxMessages: [
        {
          topic: DOCUMENT_CHECKED_IN_TOPIC,
          payload: { fileId: input.fileId, versionId, checkoutId: input.checkoutId },
        },
      ],
    },
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
  // Non-null = this is the return leg of an offline checkout; the consumer routes a cleared version
  // through commitCheckinVersion (divergence-aware) rather than commitVersion.
  readonly checkoutId: DocumentCheckoutId | null;
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
    checkout_id: DocumentCheckoutId | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    declaredSize: row.declared_size,
    declaredContentType: row.declared_content_type,
    r2Key: row.r2_key,
    name: row.file_name,
    checkoutId: row.checkout_id,
  };
}

export interface CommitVersionInput {
  readonly versionId: FileVersionId;
  readonly sizeBytes: number;
  readonly sniffedContentType: string | null;
  readonly contentSha256: string;
  // "flagged" = a definitive verdict from a real engine that found something suspicious, but the
  // firm's policy elected informed-access (allow-and-flag) rather than quarantine. The version lands
  // as status='clean' (committed + accessible) with scan_verdict='flagged'; the download gate reads
  // the verdict and applies the per-firm treatment. "unscanned" = no engine ran (no-engine adapter).
  readonly scanVerdict: "unscanned" | "clean" | "flagged";
  readonly scanEngineVersion: string | null;
  readonly scanDetail: string | null;
  readonly now: string;
  // The full raw scan result — written atomically to the content-dedup cache on a definitive verdict
  // from a real engine (clean OR flagged). Omit (or null) for unscanned commits; the cache is not
  // written then (a no-engine result is never cached — caching "we did not scan it" is worthless).
  readonly rawScanResult?: RawScanResult | null;
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
          // The session flip and the audit row below are consequences of that abandon; if a racing
          // writer moved the version first, none of them may stand.
          assertVersionStatusStatement(database, input.versionId, "abandoned"),
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
        // Everything after this point — the pointer bump, the session flip, the meter delta, the audit
        // row, and the outbox event appended to this same batch — asserts that the commit happened.
        // The assertion makes that true or takes the whole batch down with it.
        assertVersionStatusStatement(database, input.versionId, "clean"),
        bumpFileCurrentVersionStatement(database, version.fileId, input.versionId, input.now),
        setUploadSessionStatusStatement(database, input.versionId, "completed"),
        ...meterCommitStatements(
          database,
          { storageClass: "standard", artifactRole: "original", prefix: FILES_PREFIX },
          input.sizeBytes,
        ),
        // The commit row records what the intake scan found and which engine found it — the first
        // line of the version's safety history, which the Safety tab reads back off the audit log
        // because the version row only ever holds the latest verdict. Redact-by-default: verdict,
        // engine and the engine's own detail, never a file name or content.
        fileAuditStatement(database, options, "file.version_committed", input.versionId, {
          scanVerdict: input.scanVerdict,
          scanEngineVersion: input.scanEngineVersion,
          scanDetail: input.scanDetail ?? null,
        }),
        // Populate the content-dedup cache (scan-once) atomically with the commit for any definitive
        // verdict from a real engine (clean OR flagged). `unscanned`/no-engine commits are never
        // cached — caching "we did not scan it" would be worse than useless; rawScanResult is
        // optional — omit for callers that do not yet supply it, and the cache write is skipped.
        ...(input.scanVerdict !== "unscanned" &&
        input.rawScanResult != null &&
        input.contentSha256 !== null
          ? [
              recordScanCacheStatement(
                database,
                input.contentSha256,
                input.rawScanResult,
                input.now,
              ),
            ]
          : []),
        // Stamp the firm's "current scan engine version" from the engine that produced a real verdict
        // (clean OR flagged) — guarded on a non-null engineVersion, so it advances only on a
        // definitive scan. The access-triggered re-scan path compares a version's stored
        // scan_engine_version against this to decide staleness; the dedup cache is keyed on it. An
        // `unscanned`/no-engine commit never sets it, so it is never fabricated without a real scan.
        ...(input.scanVerdict !== "unscanned" &&
        input.scanEngineVersion !== null &&
        input.contentSha256 !== null
          ? [
              writeFirmSettingStatement(
                database,
                scanEngineVersionDefinition,
                input.scanEngineVersion,
                input.now,
              ),
            ]
          : []),
      ],
      outboxMessages: [
        {
          topic: FILE_VERSION_COMMITTED_TOPIC,
          payload: { fileId: version.fileId, versionId: input.versionId },
        },
      ],
    },
  };
}

export interface CommitCheckinVersionInput extends CommitVersionInput {
  // The checkout this version returned through — validated and transitioned as part of the commit.
  readonly checkoutId: DocumentCheckoutId;
}

export interface CommittedCheckinVersion {
  readonly skipped: boolean; // an unchanged round trip cut no version
  readonly diverged: boolean; // the base had advanced → a conflicting copy, current untouched
  readonly fileId: FileId;
  readonly effect: EffectWrite;
}

// Commits the cleared return leg of an offline checkout, reconciling it against the file's current
// version. If the checkout's base is still current, it is a clean fast-forward: the version commits,
// becomes current, and the checkout is released (an unchanged round trip cuts no version and just
// releases — the SHA-256 skip). If the base has advanced while the copy was out, the bytes still commit
// `clean` (they passed the gate) but the version is flagged a `conflict_pending` conflicting copy
// against its stale base, current is NOT advanced, and the checkout enters `reconciling` for a human to
// resolve. The conflicting copy is retained forever. Mirrors commitVersion's metering, scan-cache, and
// idempotency posture (it runs inside the ingest consumer's per-version idempotency batch).
export async function commitCheckinVersion(
  database: SqlDatabase,
  input: CommitCheckinVersionInput,
  options: FileServiceOptions,
): Promise<CommittedCheckinVersion> {
  const version = await loadPendingVersion(database, input.versionId);
  if (version === undefined) {
    throw new FileManagerValidationError(
      "version-not-pending",
      `version is not pending (already committed, quarantined, or unknown): ${input.versionId}`,
    );
  }
  const checkout = await getCheckoutById(database, input.checkoutId);
  if (checkout === undefined) {
    throw new FileManagerValidationError(
      "unknown-checkout",
      `no such checkout for this check-in: ${input.checkoutId}`,
    );
  }
  const file = await loadFile(database, version.fileId);
  const baseIsCurrent = file?.currentVersionId === checkout.baseVersionId;

  // Same scan-cache rule as commitVersion: cache any definitive verdict from a real engine — clean OR
  // flagged (a flagged-but-committed return leg under informed-access/allow-and-flag treatment must still
  // seed the content-dedup cache, exactly as commitVersion does). `unscanned`/no-engine is never cached.
  // rawScanResult is optional — the cache write is skipped without it.
  const scanCacheStatements =
    input.scanVerdict !== "unscanned" && input.rawScanResult != null && input.contentSha256 !== null
      ? [recordScanCacheStatement(database, input.contentSha256, input.rawScanResult, input.now)]
      : [];

  const commitStatement = commitVersionStatement(database, {
    versionId: input.versionId,
    sizeBytes: input.sizeBytes,
    sniffedContentType: input.sniffedContentType,
    contentSha256: input.contentSha256,
    scanVerdict: input.scanVerdict,
    scanEngineVersion: input.scanEngineVersion,
    scanDetail: input.scanDetail,
    committedAt: input.now,
  });
  const meterStatements = meterCommitStatements(
    database,
    { storageClass: "standard", artifactRole: "original", prefix: FILES_PREFIX },
    input.sizeBytes,
  );

  if (baseIsCurrent) {
    const { results } = await selectCurrentVersionHashStatement(database, version.fileId).all<{
      hash: string | null;
    }>();
    const currentHash = results[0]?.hash ?? null;
    if (currentHash !== null && currentHash === input.contentSha256) {
      // The offline copy came back byte-identical to the still-current version — nothing to commit.
      return {
        skipped: true,
        diverged: false,
        fileId: version.fileId,
        effect: {
          statements: [
            abandonVersionStatement(database, input.versionId),
            assertVersionStatusStatement(database, input.versionId, "abandoned"),
            setUploadSessionStatusStatement(database, input.versionId, "completed"),
            setCheckoutStatusStatement(database, input.checkoutId, "released"),
            fileAuditStatement(database, options, "document.checkin_skipped", version.fileId),
          ],
          outboxMessages: [],
        },
      };
    }
    return {
      skipped: false,
      diverged: false,
      fileId: version.fileId,
      effect: {
        statements: [
          commitStatement,
          assertVersionStatusStatement(database, input.versionId, "clean"),
          bumpFileCurrentVersionStatement(database, version.fileId, input.versionId, input.now),
          setUploadSessionStatusStatement(database, input.versionId, "completed"),
          ...meterStatements,
          setCheckoutStatusStatement(database, input.checkoutId, "released"),
          fileAuditStatement(database, options, "document.checkin_committed", version.fileId),
          ...scanCacheStatements,
        ],
        outboxMessages: [
          {
            topic: FILE_VERSION_COMMITTED_TOPIC,
            payload: { fileId: version.fileId, versionId: input.versionId },
          },
        ],
      },
    };
  }

  // The base advanced while the copy was out: land a flagged conflicting copy, never touching current.
  return {
    skipped: false,
    diverged: true,
    fileId: version.fileId,
    effect: {
      statements: [
        commitStatement,
        assertVersionStatusStatement(database, input.versionId, "clean"),
        markVersionConflictStatement(database, input.versionId, checkout.baseVersionId),
        setUploadSessionStatusStatement(database, input.versionId, "completed"),
        ...meterStatements,
        setCheckoutStatusStatement(database, input.checkoutId, "reconciling"),
        fileAuditStatement(database, options, "document.checkin_conflict", version.fileId),
        ...scanCacheStatements,
      ],
      outboxMessages: [
        {
          topic: DOCUMENT_CHECKIN_CONFLICT_TOPIC,
          payload: {
            fileId: version.fileId,
            versionId: input.versionId,
            divergedFromVersionId: checkout.baseVersionId,
          },
        },
      ],
    },
  };
}

export interface CommitEditedVersionInput {
  readonly fileId: FileId;
  readonly currentR2Key: string; // the mutable `current` working object, copied into the new version
  readonly contentSha256: string; // current's content hash (computed when it was written)
  readonly sizeBytes: number;
  readonly uploadedBy: UserId; // the session-owning member — the version's author and the audit actor
  // What kind of save this is (the member's own, the editor's autosave, the exit save, the reap).
  readonly saveKind: VersionSaveKind;
  // Every member with a view open when the cut happened, the author included; recorded on the
  // version so history can say who was there, not only whose save it was.
  readonly participants: readonly UserId[];
}

export type CommittedEditedVersion =
  // The bytes match the latest version: nothing was cut and the effect is empty.
  | { readonly skipped: true; readonly versionId: null; readonly effect: EffectWrite }
  | { readonly skipped: false; readonly versionId: FileVersionId; readonly effect: EffectWrite };

// Cuts an immutable version from the live `current` working object (the in-app editing path; there is
// no upload session). A server-side R2 copy moves `current`'s bytes into the new version's opaque key,
// then one batch inserts the committed version, advances the file's current pointer, meters the bytes,
// audits, and emits the outbox event. An explicit save whose content matches the latest version is a
// no-op — nothing is copied and no version is cut (the SHA-256 skip). copyObject is the injected
// server-side R2 copy (current key -> version key), never a buffer through the Worker.
export async function commitEditedVersion(
  database: SqlDatabase,
  input: CommitEditedVersionInput,
  options: FileServiceOptions,
  copyObject: (fromKey: string, toKey: string) => Promise<void>,
): Promise<CommittedEditedVersion> {
  const { results } = await selectCurrentVersionHashStatement(database, input.fileId).all<{
    hash: string | null;
  }>();
  const currentHash = results[0]?.hash ?? null;
  if (currentHash !== null && currentHash === input.contentSha256) {
    return { skipped: true, versionId: null, effect: { statements: [], outboxMessages: [] } };
  }

  const { results: maxResults } = await selectMaxVersionNumberStatement(
    database,
    input.fileId,
  ).all<{ n: number }>();
  const versionNumber = (maxResults[0]?.n ?? 0) + 1;
  const versionId = newIdentifier("fileVersion", options.randomSource);
  const r2Key = fileVersionKey(input.fileId, versionId);
  const now = options.clock.now();

  // Move the bytes server-side BEFORE the metadata batch: if the copy fails, no row points at a
  // missing object. The version row is inserted then immediately committed in the same atomic batch,
  // so it is never observably pending. An in-app edit is trusted (no untrusted ingest), so the verdict
  // is `unscanned`; the offline check-in path is what routes through the scan gate.
  await copyObject(input.currentR2Key, r2Key);

  return {
    skipped: false,
    versionId,
    effect: {
      statements: [
        insertFileVersionStatement(database, {
          id: versionId,
          fileId: input.fileId,
          versionNumber,
          r2Key,
          declaredContentType: null,
          uploadedBy: input.uploadedBy,
          createdAt: now,
          saveKind: input.saveKind,
        }),
        commitVersionStatement(database, {
          versionId,
          sizeBytes: input.sizeBytes,
          sniffedContentType: null,
          contentSha256: input.contentSha256,
          scanVerdict: "unscanned",
          scanEngineVersion: null,
          scanDetail: null,
          committedAt: now,
        }),
        ...insertVersionParticipantStatements(database, versionId, [
          ...new Set([input.uploadedBy, ...input.participants]),
        ]),
        bumpFileCurrentVersionStatement(database, input.fileId, versionId, now),
        ...meterCommitStatements(
          database,
          { storageClass: "standard", artifactRole: "original", prefix: FILES_PREFIX },
          input.sizeBytes,
        ),
        fileAuditStatement(database, options, "file.version_committed", versionId),
      ],
      outboxMessages: [
        { topic: FILE_VERSION_COMMITTED_TOPIC, payload: { fileId: input.fileId, versionId } },
      ],
    },
  };
}

export interface DuplicateVersionInput {
  /** The committed version whose bytes the new file takes. */
  readonly sourceVersionId: FileVersionId;
  readonly matterId: MatterId;
  readonly folderId?: FolderId | null;
  readonly name: string;
  readonly documentTypeId?: DocumentTypeId | null;
  readonly uploadedBy: UserId | null;
  readonly sourceModifiedAt?: string | null;
  readonly createdAtBasis?: "upload" | "source";
}

export interface DuplicatedVersion {
  readonly fileId: FileId;
  readonly versionId: FileVersionId;
  readonly effect: EffectWrite;
}

// Makes a NEW file on a matter out of bytes the firm already holds, without a byte crossing the
// network: the upload dialog hashed the reader's file, the firm's record answered that a committed
// version has exactly those bytes, and so the version is copied server-side into the new file's own
// key and committed at once with the facts the gate reached the first time. The verdict carries
// across because the bytes are the same bytes; the dating and the document type are the new file's
// own, chosen at the intake like any upload's. copyObject is the injected bucket copy (source key ->
// the new version's key, restamped with the TARGET matter's dimensions), never a buffer through the
// Worker; it runs before the batch so no row can point at an object that is not there.
export async function duplicateVersionIntoMatter(
  database: SqlDatabase,
  input: DuplicateVersionInput,
  options: FileServiceOptions,
  copyObject: (fromKey: string, toKey: string, dimensions: ObjectDimensions) => Promise<void>,
): Promise<DuplicatedVersion> {
  const { results } = await selectCleanVersionFactsStatement(database, input.sourceVersionId).all<{
    id: FileVersionId;
    file_id: FileId;
    r2_key: string;
    size_bytes: number | null;
    declared_content_type: string | null;
    sniffed_content_type: string | null;
    content_sha256: string | null;
    scan_verdict: "unscanned" | "clean" | "flagged" | null;
    scan_engine_version: string | null;
    scan_detail: string | null;
  }>();
  const source = results[0];
  // A version without a recorded hash could never have been matched to a reader's file, so a
  // request naming one is not answering a match the firm made; it is refused with the missing one.
  if (source === undefined || source.content_sha256 === null) {
    throw new FileManagerValidationError(
      "version-not-clean",
      `no committed version to duplicate: ${input.sourceVersionId}`,
    );
  }
  const contentSha256 = source.content_sha256;
  // The source file must still be live: a deleted file's bytes are not on offer, and a duplicate
  // must not be the one path that confirms a deleted file still exists.
  await requireLiveFile(database, source.file_id);
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

  const now = options.clock.now();
  const sourceModifiedAt = validSourceInstant(input.sourceModifiedAt);
  const fileCreatedAt = recordedCreationInstant(input.createdAtBasis, sourceModifiedAt, now);
  const fileId = newIdentifier("file", options.randomSource);
  const versionId = newIdentifier("fileVersion", options.randomSource);
  const r2Key = fileVersionKey(fileId, versionId);
  const sizeBytes = source.size_bytes ?? 0;

  await copyObject(
    source.r2_key,
    r2Key,
    matterScopedObjectDimensions({ objectClass: "working-document", matterId: input.matterId }),
  );

  return {
    fileId,
    versionId,
    effect: {
      statements: [
        insertFileStatement(database, {
          id: fileId,
          matterId: input.matterId,
          folderId: input.folderId ?? null,
          name: input.name,
          documentTypeId: input.documentTypeId ?? null,
          createdAt: fileCreatedAt,
        }),
        insertFileVersionStatement(database, {
          id: versionId,
          fileId,
          versionNumber: 1,
          r2Key,
          declaredContentType: source.declared_content_type,
          uploadedBy: input.uploadedBy,
          createdAt: now,
          sourceModifiedAt,
        }),
        commitVersionStatement(database, {
          versionId,
          sizeBytes,
          sniffedContentType: source.sniffed_content_type,
          contentSha256,
          // A clean-status version always carries a verdict; the column's nullability is for the
          // pending row it once was, so a null here reads as the engine-less launch verdict.
          scanVerdict: source.scan_verdict ?? "unscanned",
          scanEngineVersion: source.scan_engine_version,
          scanDetail: source.scan_detail,
          committedAt: now,
        }),
        assertVersionStatusStatement(database, versionId, "clean"),
        bumpFileCurrentVersionStatement(database, fileId, versionId, now),
        ...meterCommitStatements(
          database,
          { storageClass: "standard", artifactRole: "original", prefix: FILES_PREFIX },
          sizeBytes,
        ),
        // Ids only: which version the bytes came from, so the trail says this file was made from
        // one the firm already held rather than from an upload.
        fileAuditStatement(database, options, "file.version_committed", versionId, {
          duplicatedFromVersionId: source.id,
          folderId: input.folderId ?? null,
        }),
      ],
      outboxMessages: [{ topic: FILE_VERSION_COMMITTED_TOPIC, payload: { fileId, versionId } }],
    },
  };
}

export interface RescanVerdictInput {
  readonly fileId: FileId;
  readonly versionId: FileVersionId;
  readonly scanVerdict: "clean" | "flagged";
  readonly scanEngineVersion: string; // the engine that produced this verdict — never null on a re-scan
  readonly scanDetail: string | null;
  readonly signature: string | null; // malware signature name for 'flagged'; null for 'clean'
  readonly contentSha256: string;
  readonly now: string;
  // The full raw scan result — written to the content-dedup cache when provided. Omit (or null) for
  // legacy call sites that do not yet supply it; the cache write is skipped but the verdict stamp lands.
  readonly rawScanResult?: RawScanResult | null;
  // The request this re-scan answers, when a member asked for it by hand; the audit row carries it
  // so the history can pair the request with its result.
  readonly requestId?: string;
}

// Applies an in-place re-scan verdict to an already-committed version: stamps scan_verdict /
// scan_engine_version / scan_detail WITHOUT moving the current-version pointer or changing visibility
// (a flagged finding stays accessible behind the download gate — informed access, no data loss),
// records the DEFINITIVE verdict in the per-firm dedup cache so identical content re-scanned under the
// same engine reuses it, and writes one audit row. The caller passes only a real engine verdict; a scan
// fault never reaches here, so a version's prior verdict is never downgraded without a real scan.
export function recordRescanVerdict(
  database: SqlDatabase,
  input: RescanVerdictInput,
  options: FileServiceOptions,
): { effect: EffectWrite } {
  return {
    effect: {
      statements: [
        rescanVerdictStatement(database, {
          versionId: input.versionId,
          scanVerdict: input.scanVerdict,
          scanEngineVersion: input.scanEngineVersion,
          scanDetail: input.scanDetail,
        }),
        // Write the raw scan result to the content-dedup cache when the caller supplies it.
        // rawScanResult is optional — legacy callers that do not yet supply it skip the cache write.
        ...(input.rawScanResult != null
          ? [
              recordScanCacheStatement(
                database,
                input.contentSha256,
                input.rawScanResult,
                input.now,
              ),
            ]
          : []),
        // The same three facts as the commit row, so the history reads one engine per line.
        fileAuditStatement(database, options, "file.version_rescanned", input.versionId, {
          scanVerdict: input.scanVerdict,
          scanEngineVersion: input.scanEngineVersion,
          scanDetail: input.scanDetail,
          ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        }),
      ],
      // Notify on a fresh flagged finding so the file's users learn their already-visible file is now
      // flagged (informed access — the file is not hidden). The re-scan idempotency key
      // (rescan:<versionId>:<engineVersion>) guarantees this runs at most once per version per engine,
      // so the event fires once per fresh finding, never per access. Delivery is the outbox relay's
      // concern (the same seam file.quarantined uses); a clean re-scan emits nothing.
      outboxMessages:
        input.scanVerdict === "flagged"
          ? [
              {
                topic: FILE_RESCAN_INFECTED_TOPIC,
                payload: { fileId: input.fileId, versionId: input.versionId },
              },
            ]
          : [],
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
        // Gate quarantines (a type lie, a size lie, a policy breach) carry no scan detail — nothing
        // scanned them. Persist the REASON in that case so the row itself says why it was pulled: the
        // outbox message and the telemetry event are transient, and a reviewer opening a quarantined
        // version months later has only this column to distinguish a malware hit from a size lie.
        quarantineVersionStatement(database, input.versionId, input.scanDetail ?? input.reason),
        // The audit row and the file.quarantined event this batch also carries must not outlive a
        // quarantine that lost its race to an abort or expiry.
        assertVersionStatusStatement(database, input.versionId, "quarantined"),
        // The reason is the scanner's own words (or the gate's), never file content; the history
        // reads it as the detail on this line.
        fileAuditStatement(database, options, "file.quarantined", input.versionId, {
          scanVerdict: "flagged",
          scanDetail: input.scanDetail ?? input.reason,
        }),
      ],
      outboxMessages: [
        {
          topic: FILE_QUARANTINED_TOPIC,
          payload: { versionId: input.versionId, reason: input.reason },
        },
      ],
    },
  };
}

// Withdraws an ALREADY-COMMITTED version whose stored bytes no longer match the hash recorded at
// commit. The committed row asserts "these bytes, this hash, this verdict"; once the object behind it
// changes, every one of those facts describes bytes that are gone, and serving the version would put
// a clean verdict on content nothing ever inspected. So the version goes behind the status gate and
// stays there — it is NOT re-committed with the new facts, because a committed version is immutable
// by construction (new bytes are a new version, minted through the upload path with its own ingest).
//
// Recovery is a deliberate act: the file's owner uploads the intended content as a new version, which
// ingests normally. There is no path that returns these bytes to 'clean'.
//
// The storage meter is NOT reversed: the object is still in the firm's bucket occupying real storage,
// and the meter counts bytes held, not bytes servable.
export function quarantineCommittedVersion(
  database: SqlDatabase,
  input: {
    fileId: FileId;
    versionId: FileVersionId;
    reason: string;
    scanDetail: string | null;
  },
  options: FileServiceOptions,
): { effect: EffectWrite } {
  return {
    effect: {
      statements: [
        quarantineCommittedVersionStatement(
          database,
          input.versionId,
          input.scanDetail ?? input.reason,
        ),
        repointCurrentVersionAfterWithdrawalStatement(
          database,
          input.fileId,
          input.versionId,
          options.clock.now(),
        ),
        fileAuditStatement(database, options, "file.quarantined", input.versionId, {
          scanVerdict: "flagged",
          scanDetail: input.scanDetail ?? input.reason,
        }),
      ],
      outboxMessages: [
        {
          topic: FILE_QUARANTINED_TOPIC,
          payload: { fileId: input.fileId, versionId: input.versionId, reason: input.reason },
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
  // The same blank-name rule the folder service applies, for the same reason: the schema CHECK would
  // otherwise reject a whitespace-only rename as a raw constraint failure — a server error for what is
  // a plainly bad request.
  if (name.trim().length === 0) {
    throw new FileManagerValidationError("invalid-name", "a name cannot be blank");
  }
  await requireLiveFile(database, fileId);
  return {
    effect: {
      statements: [
        renameFileStatement(database, fileId, name, options.clock.now()),
        // Deliberately bare: a file name is free text a person routinely writes another person's
        // name into, and audit metadata carries ids and non-privileged facts only (audit.ts) — so a
        // rename's from/to names are never recorded, and the history renders honest blanks for them.
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
  const file = await requireLiveFile(database, fileId);
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
        // Where it was and where it went — folder ids only (null = the matter root), never names;
        // the history read resolves them to CURRENT path text. Uses the row already loaded above.
        fileAuditStatement(database, options, "file.moved", fileId, {
          fromFolderId: file.folderId,
          toFolderId: folderId,
        }),
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
  await requireLiveFile(database, fileId);
  return {
    effect: {
      statements: [
        assignDocumentTypeStatement(database, fileId, documentTypeId, options.clock.now()),
        // The assigned type's id (an explicit null records the type being CLEARED); the history read
        // resolves the id to the type's current name. Never the name itself — redact-by-default.
        fileAuditStatement(database, options, "file.document_type_assigned", fileId, {
          documentTypeId,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Soft-deletes a file: sets deleted_at and destroys the live working copy with it — the current_*
// pointer is cleared and the file returns to idle. Returns the `current` R2 object key (or null) so the
// caller deletes that object; the route also reaps any live editing session first. The committed
// versions and their bytes are retained — indefinitely by default, and only a retention policy ever
// destroys them, through purgeableVersionObjects below — so only the transient working copy dies. The
// working copy is the one object a delete may destroy on its own: it is keyed to this file alone and
// re-materializes from the committed version, so no other row can be holding it.
export async function softDeleteFile(
  database: SqlDatabase,
  fileId: FileId,
  options: FileServiceOptions,
): Promise<{ effect: EffectWrite; currentR2Key: string | null }> {
  // Already deleted refuses rather than re-stamping deleted_at: a second delete would move the
  // recovery window's start and write another audit row for a file that is already gone.
  const file = await requireLiveFile(database, fileId);
  return {
    currentR2Key: file.currentR2Key,
    effect: {
      statements: [
        softDeleteFileStatement(database, fileId, options.clock.now()),
        clearCurrentObjectStatement(database, fileId, options.clock.now()),
        // The folder the file was deleted out of (null = the matter root) — the id only, from the
        // row already loaded; the history read resolves it to current path text.
        fileAuditStatement(database, options, "file.deleted", fileId, {
          fromFolderId: file.folderId,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface VersionObjectToDestroy {
  readonly versionId: FileVersionId;
  readonly r2Key: string;
  /**
   * The version's export copy (every change accepted), when it has one of its own. Derived from the
   * version's bytes and named by no other row, so it goes wherever the version's object goes.
   */
  readonly exportR2Key: string | null;
  /**
   * The version's playable copy (a video converted for every browser), when one was made. Derived
   * from the version's bytes the same way, so it goes wherever the version's object goes.
   */
  readonly playableCopyR2Key: string | null;
}

export interface VersionObjectRetained extends VersionObjectToDestroy {
  /** How many other version rows, on any file, still name these bytes. */
  readonly heldBy: number;
}

export interface PurgeableVersionObjects {
  /** The objects nothing else names: the only ones a purge may destroy. */
  readonly destroy: readonly VersionObjectToDestroy[];
  /** The objects another row still holds by content or by key, with the count. */
  readonly retained: readonly VersionObjectRetained[];
}

/*
 * THE PURGE POINT — the one door through which a committed version's bytes may ever be destroyed.
 *
 * A file the firm already holds is never uploaded again: the browser hashes it, the firm is asked,
 * and a match is made from the held bytes rather than sent. So one set of bytes can stand behind
 * several files — on several matters, some of them since deleted — and the bytes belong to every
 * row that names them, not to the row that happened to arrive first. Deleting one of those files
 * therefore never deletes the bytes. They go only once the LAST row naming them goes, and a
 * soft-deleted row still names them: it is recoverable, and a recovered file with no bytes behind
 * it is not a recovery.
 *
 * Nothing calls this today by design. Deletion is a soft delete that destroys nothing but the
 * working copy, default retention is indefinite, and destruction is a records-management act the
 * retention policy engine performs when it is built — never a file-manager gesture. That engine
 * calls this, per file, and destroys exactly `destroy`; it does not compute its own list, because
 * the reference count is the whole safety of the operation and lives here once. The check counts
 * a reference by the hash of the content as well as by the object key, so it holds whether the
 * held bytes were copied under a new key (today) or shared under one (a storage economy the
 * platform may take later).
 *
 * Refuses a live file: a purge is what follows a deletion, never a substitute for one.
 */
export async function purgeableVersionObjects(
  database: SqlDatabase,
  fileId: FileId,
): Promise<PurgeableVersionObjects> {
  const file = await requireFileIncludingDeleted(database, fileId);
  if (file.deletedAt === null) {
    throw new FileManagerValidationError("file-not-deleted", `file is not deleted: ${fileId}`);
  }
  const { results: versions } = await selectVersionObjectsOfFileStatement(database, fileId).all<{
    id: FileVersionId;
    r2_key: string;
    content_sha256: string | null;
    export_r2_key: string | null;
    playable_copy_r2_key: string | null;
  }>();
  const destroy: VersionObjectToDestroy[] = [];
  const retained: VersionObjectRetained[] = [];
  for (const version of versions) {
    const { results } = await countOtherVersionsHoldingBytesStatement(database, {
      versionId: version.id,
      contentSha256: version.content_sha256,
      r2Key: version.r2_key,
    }).all<{ held_by: number }>();
    const heldBy = results[0]?.held_by ?? 0;
    // A copy recorded at the version's own key is the version's bytes themselves (nothing was
    // recorded in them), not a second object.
    const exportR2Key =
      version.export_r2_key === null || version.export_r2_key === version.r2_key
        ? null
        : version.export_r2_key;
    const playableCopyR2Key = version.playable_copy_r2_key;
    if (heldBy > 0) {
      retained.push({
        versionId: version.id,
        r2Key: version.r2_key,
        exportR2Key,
        playableCopyR2Key,
        heldBy,
      });
    } else {
      destroy.push({
        versionId: version.id,
        r2Key: version.r2_key,
        exportR2Key,
        playableCopyR2Key,
      });
    }
  }
  return { destroy, retained };
}

export interface RestoreFileDestination {
  // Present = restore INTO this folder (null = the matter root), validated against the file's
  // matter. Absent = keep the folder the file was deleted from — unless that folder no longer
  // exists, in which case the restore falls back to the matter root rather than stranding the file
  // under a pointer nothing can browse to.
  readonly folderId?: FolderId | null;
}

// Undeletes a soft-deleted file: clears deleted_at so it returns to the default listing. The `current`
// working copy re-materializes lazily from current_version_id on the next edit launch (GetFile falls
// back to the committed version when `current` is absent), so nothing is copied here. Returns the
// folder the file lands in so the caller can report where the restore put it.
export async function restoreFile(
  database: SqlDatabase,
  fileId: FileId,
  options: FileServiceOptions,
  destination: RestoreFileDestination = {},
): Promise<{ effect: EffectWrite; folderId: FolderId | null }> {
  // The one write that must resolve a soft-deleted row — an undelete has to find the row precisely
  // because it is soft-deleted.
  const file = await requireFileIncludingDeleted(database, fileId);
  // Restoring a live file refuses rather than no-opping: a second restore would write another audit
  // row claiming a recovery that never happened, and the caller deserves to learn its picture of the
  // file is stale.
  if (file.deletedAt === null) {
    throw new FileManagerValidationError("file-not-deleted", `file is not deleted: ${fileId}`);
  }
  let targetFolderId: FolderId | null;
  if (destination.folderId !== undefined) {
    if (destination.folderId !== null) {
      // The chosen destination must exist and live in the file's matter — the same guard every move
      // enforces, so a restore can never park a file under another matter's folder.
      const folderMatterId = await loadFolderMatter(database, destination.folderId);
      if (folderMatterId === undefined) {
        throw new FileManagerValidationError(
          "unknown-folder",
          `no such folder: ${destination.folderId}`,
        );
      }
      if (folderMatterId !== file.matterId) {
        throw new FileManagerValidationError(
          "file-cross-matter",
          "a file's restore destination must belong to the same matter",
        );
      }
    }
    targetFolderId = destination.folderId;
  } else if (file.folderId !== null) {
    // No destination chosen: keep the stored folder when it still exists, otherwise fall back to the
    // matter root — a restored file must land somewhere the folder tree can reach.
    targetFolderId =
      (await loadFolderMatter(database, file.folderId)) === undefined ? null : file.folderId;
  } else {
    targetFolderId = null;
  }
  return {
    folderId: targetFolderId,
    effect: {
      statements: [
        restoreFileStatement(database, fileId, options.clock.now()),
        ...(targetFolderId === file.folderId
          ? []
          : [moveFileStatement(database, fileId, targetFolderId, options.clock.now())]),
        // The metadata names where the file landed only when the restore moved it — the common
        // straight-home restore stays a bare event (ids only, redact-by-default). The key matches
        // the move event's `toFolderId`; the history read still resolves the `restoredToFolderId`
        // key earlier restores recorded.
        fileAuditStatement(
          database,
          options,
          "file.restored",
          fileId,
          targetFolderId === file.folderId ? undefined : { toFolderId: targetFolderId },
        ),
      ],
      outboxMessages: [],
    },
  };
}

export interface RestoreVersionInput {
  readonly fileId: FileId;
  readonly sourceVersionId: FileVersionId; // the archived clean version to bring forward
  readonly uploadedBy: UserId; // the actor restoring — the new version's author
}

// Restores an archived version FORWARD: copies a chosen clean version's bytes into a brand-new version
// (version_number = max + 1) that becomes current, leaving all history untouched (no rewrite, no
// pointer regression). The bytes move server-side (the injected copyObject: source version key -> new
// version key), never through the Worker. A no-op when the source already matches the current content
// (the SHA-256 skip), so restoring the live version cuts nothing. Mirrors commitEditedVersion's
// commit/meter/audit posture, sourced from an archived version instead of the live working copy.
export async function restoreVersion(
  database: SqlDatabase,
  input: RestoreVersionInput,
  options: FileServiceOptions,
  copyObject: (fromKey: string, toKey: string) => Promise<void>,
): Promise<CommittedEditedVersion> {
  const { results } = await selectCleanVersionByIdStatement(database, input.sourceVersionId).all<{
    file_id: FileId;
    r2_key: string;
    content_sha256: string | null;
    size_bytes: number | null;
  }>();
  const source = results[0];
  if (source === undefined || source.file_id !== input.fileId) {
    throw new FileManagerValidationError(
      "unknown-version",
      `no such clean version on this file: ${input.sourceVersionId}`,
    );
  }

  const { results: currentResults } = await selectCurrentVersionHashStatement(
    database,
    input.fileId,
  ).all<{ hash: string | null }>();
  const currentHash = currentResults[0]?.hash ?? null;
  if (currentHash !== null && currentHash === source.content_sha256) {
    // The chosen version is already the current content — restoring it would cut a duplicate.
    return { skipped: true, versionId: null, effect: { statements: [], outboxMessages: [] } };
  }

  const { results: maxResults } = await selectMaxVersionNumberStatement(
    database,
    input.fileId,
  ).all<{ n: number }>();
  const versionNumber = (maxResults[0]?.n ?? 0) + 1;
  const versionId = newIdentifier("fileVersion", options.randomSource);
  const r2Key = fileVersionKey(input.fileId, versionId);
  const now = options.clock.now();
  const sizeBytes = source.size_bytes ?? 0;

  // Move the bytes server-side BEFORE the metadata batch: if the copy fails, no row points at a
  // missing object. The restored version is a trusted in-app copy of an already-scanned version, so
  // the verdict is `unscanned` (the offline check-in path is what routes the scan gate).
  await copyObject(source.r2_key, r2Key);

  return {
    skipped: false,
    versionId,
    effect: {
      statements: [
        insertFileVersionStatement(database, {
          id: versionId,
          fileId: input.fileId,
          versionNumber,
          r2Key,
          declaredContentType: null,
          uploadedBy: input.uploadedBy,
          createdAt: now,
        }),
        commitVersionStatement(database, {
          versionId,
          sizeBytes,
          sniffedContentType: null,
          contentSha256: source.content_sha256 ?? "",
          scanVerdict: "unscanned",
          scanEngineVersion: null,
          scanDetail: null,
          committedAt: now,
        }),
        bumpFileCurrentVersionStatement(database, input.fileId, versionId, now),
        ...meterCommitStatements(
          database,
          { storageClass: "standard", artifactRole: "original", prefix: FILES_PREFIX },
          sizeBytes,
        ),
        fileAuditStatement(database, options, "file.version_restored", versionId),
      ],
      outboxMessages: [
        { topic: FILE_VERSION_COMMITTED_TOPIC, payload: { fileId: input.fileId, versionId } },
      ],
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

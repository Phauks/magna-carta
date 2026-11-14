import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  MatterExhibitId,
  MatterId,
} from "@magna-carta/identifiers/types";
import {
  archiveMatterExhibitStatement,
  countMatterExhibits,
  insertMatterExhibitStatement,
  isCleanVersionOf,
  readAttachableFile,
  readMatterExhibit,
  readReferenceNamesLike,
  updateMatterExhibitStatement,
  type MatterExhibitRow,
} from "./exhibit-statements.ts";
import { assertReferenceName, mintReferenceName, referenceNameBaseFor } from "./reference-name.ts";
import { MAX_EXHIBITS_PER_MATTER, type ExhibitServiceOptions } from "./types.ts";
import {
  ExhibitValidationError,
  assertSourceKind,
  assertTitle,
  optionalDescription,
} from "./validation.ts";

// An exhibit: one document's identity on one matter.
//
// NO BYTES EVER REACH THIS MODULE. An exhibit links a file that the File Manager's upload and
// quarantine chokepoint already produced, and the file stays an ordinary matter document: in the
// file list, previewable, under any hold. Audit rows carry identifiers only, never a title.

export interface CreateExhibitInput {
  readonly matterId: MatterId;
  readonly fileId: FileId;
  readonly title: unknown;
  readonly description?: unknown;
  readonly sourceKind?: unknown;
  readonly referenceName?: unknown;
  readonly pinnedFileVersionId?: FileVersionId | null;
  readonly pageCount?: number | null;
}

async function assertAttachable(
  database: SqlDatabase,
  matterId: MatterId,
  fileId: FileId,
  pinnedFileVersionId: FileVersionId | null,
): Promise<void> {
  const file = await readAttachableFile(database, fileId);
  // A file on another matter is refused rather than attached: an exhibit is one matter's fact, and
  // a cross-matter link would leak one matter's file list into another's filing.
  if (file === undefined || file.matterId !== matterId) {
    throw new ExhibitValidationError("exhibit-file-unavailable", "no such file on this matter");
  }
  if (pinnedFileVersionId !== null) {
    if (!(await isCleanVersionOf(database, fileId, pinnedFileVersionId))) {
      throw new ExhibitValidationError(
        "exhibit-file-unavailable",
        "the chosen version is not a clean version of this file",
      );
    }
  } else if (!file.currentVersionClean) {
    throw new ExhibitValidationError(
      "exhibit-file-unavailable",
      "the file has no clean version yet; it can be attached once its scan finishes",
    );
  }
}

function assertPageCount(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new ExhibitValidationError("exhibit-invalid-input", "pageCount is a whole number");
  }
  return value;
}

export async function createExhibit(
  database: SqlDatabase,
  input: CreateExhibitInput,
  options: ExhibitServiceOptions,
): Promise<{ exhibitId: MatterExhibitId; referenceName: string; effect: EffectWrite }> {
  const title = assertTitle(input.title);
  const description = optionalDescription(input.description);
  const sourceKind = assertSourceKind(input.sourceKind ?? "matterFile");
  const pinnedFileVersionId = input.pinnedFileVersionId ?? null;
  const pageCount = assertPageCount(input.pageCount);
  await assertAttachable(database, input.matterId, input.fileId, pinnedFileVersionId);

  if ((await countMatterExhibits(database, input.matterId)) >= MAX_EXHIBITS_PER_MATTER) {
    throw new ExhibitValidationError(
      "exhibit-bound-exceeded",
      `a matter holds at most ${MAX_EXHIBITS_PER_MATTER} exhibits`,
    );
  }

  let referenceName: string;
  if (input.referenceName !== undefined && input.referenceName !== null) {
    referenceName = assertReferenceName(input.referenceName);
    const taken = await readReferenceNamesLike(database, input.matterId, referenceName);
    if (taken.has(referenceName)) {
      throw new ExhibitValidationError(
        "exhibit-reference-name-taken",
        "another exhibit on this matter already has that reference name",
      );
    }
  } else {
    const base = referenceNameBaseFor(title);
    referenceName = mintReferenceName(
      base,
      await readReferenceNamesLike(database, input.matterId, base),
    );
  }

  const now = options.clock.now();
  const exhibitId = newIdentifier("matterExhibit", options.randomSource);
  return {
    exhibitId,
    referenceName,
    effect: {
      statements: [
        insertMatterExhibitStatement(database, {
          id: exhibitId,
          matter_id: input.matterId,
          reference_name: referenceName,
          title,
          description,
          source_kind: sourceKind,
          file_id: input.fileId,
          pinned_file_version_id: pinnedFileVersionId,
          page_count: pageCount,
          bates_begin: null,
          bates_end: null,
          created_by: options.actorUserId,
          created_at: now,
        }),
        domainAuditStatement(database, {
          event: "exhibit.created",
          subjectId: exhibitId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: input.matterId, fileId: input.fileId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface EditExhibitInput {
  readonly title?: unknown;
  readonly description?: unknown;
  /** A version id pins it; null floats it on the file's current clean version; absent keeps it. */
  readonly pinnedFileVersionId?: FileVersionId | null;
  readonly pageCount?: number | null;
}

/** Look up an exhibit and refuse one that is absent or on another matter. */
export async function requireExhibit(
  database: SqlDatabase,
  matterId: MatterId,
  exhibitId: MatterExhibitId,
): Promise<MatterExhibitRow> {
  const exhibit = await readMatterExhibit(database, exhibitId);
  if (exhibit === undefined || exhibit.matter_id !== matterId) {
    throw new ExhibitValidationError("exhibit-unknown-exhibit", "no such exhibit on this matter");
  }
  return exhibit;
}

// Retitling never touches the reference name. A document that cites {{@leaseAgreement}} keeps
// citing the same exhibit after it is renamed "Commercial Lease, 1200 Harbor Way".
export async function editExhibit(
  database: SqlDatabase,
  matterId: MatterId,
  exhibitId: MatterExhibitId,
  input: EditExhibitInput,
  options: ExhibitServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const exhibit = await requireExhibit(database, matterId, exhibitId);
  const title = input.title === undefined ? exhibit.title : assertTitle(input.title);
  const description =
    input.description === undefined ? exhibit.description : optionalDescription(input.description);
  const pinnedFileVersionId =
    input.pinnedFileVersionId === undefined
      ? exhibit.pinned_file_version_id
      : input.pinnedFileVersionId;
  const pageCount =
    input.pageCount === undefined ? exhibit.page_count : assertPageCount(input.pageCount);
  if (pinnedFileVersionId !== exhibit.pinned_file_version_id) {
    await assertAttachable(database, matterId, exhibit.file_id, pinnedFileVersionId);
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateMatterExhibitStatement(database, exhibitId, {
          title,
          description,
          pinnedFileVersionId,
          pageCount,
          now,
        }),
        domainAuditStatement(database, {
          event: "exhibit.edited",
          subjectId: exhibitId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Archiving hides an exhibit from the register and from pickers. It does not remove it from any set:
// an issued set must keep pointing at what it filed, and a draft member is removed on its own.
export async function archiveExhibit(
  database: SqlDatabase,
  matterId: MatterId,
  exhibitId: MatterExhibitId,
  options: ExhibitServiceOptions,
): Promise<{ effect: EffectWrite }> {
  await requireExhibit(database, matterId, exhibitId);
  return {
    effect: {
      statements: [
        archiveMatterExhibitStatement(database, exhibitId, options.clock.now()),
        domainAuditStatement(database, {
          event: "exhibit.archived",
          subjectId: exhibitId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

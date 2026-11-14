import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import {
  guarded,
  type EffectStatement,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  ExhibitSetId,
  ExhibitSetMemberId,
  FileId,
  FolderId,
  MatterExhibitId,
  MatterId,
} from "@magna-carta/identifiers/types";
import {
  countMatterExhibits,
  insertMatterExhibitStatement,
  MATTER_EXHIBIT_TABLE,
} from "./exhibit-statements.ts";
import {
  appendMemberStatement,
  deleteDraftMemberStatement,
  EXHIBIT_SET_MEMBER_TABLE,
  reorderStatements,
} from "./member-statements.ts";
import { ORDER_GUARD } from "./member-service.ts";
import { DEFAULT_EXHIBIT_SCHEME } from "./presets.ts";
import { mintReferenceName, referenceNameBaseFor } from "./reference-name.ts";
import { DRAFT_SET_GUARD, assertDraft, requireSet } from "./set-service.ts";
import { insertExhibitSetStatement } from "./set-statements.ts";
import {
  MAX_EXHIBITS_PER_MATTER,
  MAX_MEMBERS_PER_SET,
  MAX_TITLE_LENGTH,
  type ExhibitServiceOptions,
} from "./types.ts";
import { ExhibitValidationError, assertScheme, assertSetName } from "./validation.ts";

// A set made from a folder, and kept following it while it is a draft.
//
// The folder is how a member already gathers a filing's documents, so it is where a set can start:
// the folder's files become the set's exhibits in name order. While the set is a draft it follows
// the folder: a file put in the folder joins at the end, and a file taken out (moved, or deleted)
// leaves, with the exhibits after it moving up a label. The order a member arranges is kept; the
// folder decides who is in the set, not where. Issuing stops the following, because an issued set
// never changes.
//
// Only files directly in the folder count, not files in folders inside it, and a file joins only
// once it has a clean version: a file still being scanned waits for the next follow.

interface FolderFileRow {
  readonly id: FileId;
  readonly name: string;
  readonly clean: number;
}

interface FolderRow {
  readonly id: FolderId;
  readonly matter_id: MatterId;
  readonly name: string;
}

async function requireFolder(
  database: SqlDatabase,
  matterId: MatterId,
  folderId: FolderId,
): Promise<FolderRow> {
  const { results } = await database
    .prepare("SELECT id, matter_id, name FROM folder WHERE id = ?1")
    .bind(folderId)
    .all<FolderRow>();
  const folder = results[0];
  if (folder === undefined || folder.matter_id !== matterId) {
    throw new ExhibitValidationError("exhibit-unknown-folder", "no such folder on this matter");
  }
  return folder;
}

// Every live file directly in the folder, in the order a member reads the folder: by name, then by
// id so two files with one name keep a stable order.
async function readFolderFiles(
  database: SqlDatabase,
  matterId: MatterId,
  folderId: FolderId,
): Promise<FolderFileRow[]> {
  const { results } = await database
    .prepare(
      "SELECT f.id, f.name, (v.status = 'clean') AS clean FROM file f " +
        "LEFT JOIN file_version v ON v.id = f.current_version_id " +
        "WHERE f.matter_id = ?1 AND f.folder_id = ?2 AND f.deleted_at IS NULL " +
        "ORDER BY f.name COLLATE NOCASE, f.id",
    )
    .bind(matterId, folderId)
    .all<FolderFileRow>();
  return results;
}

// The live exhibit each file already has on the matter, so a file that is an exhibit in another set
// keeps one identity and one reference name rather than gaining a second.
async function readExhibitsByFile(
  database: SqlDatabase,
  matterId: MatterId,
  fileIds: readonly FileId[],
): Promise<Map<FileId, MatterExhibitId>> {
  if (fileIds.length === 0) return new Map();
  const { results } = await database
    .prepare(
      `SELECT file_id, MIN(id) AS id FROM ${MATTER_EXHIBIT_TABLE} WHERE matter_id = ?1 ` +
        `AND archived_at IS NULL AND file_id IN (SELECT value FROM json_each(?2)) GROUP BY file_id`,
    )
    .bind(matterId, JSON.stringify(fileIds))
    .all<{ file_id: FileId; id: MatterExhibitId }>();
  return new Map(results.map((row) => [row.file_id, row.id]));
}

async function readReferenceNames(database: SqlDatabase, matterId: MatterId): Promise<Set<string>> {
  const { results } = await database
    .prepare(`SELECT reference_name FROM ${MATTER_EXHIBIT_TABLE} WHERE matter_id = ?1`)
    .bind(matterId)
    .all<{ reference_name: string }>();
  return new Set(results.map((row) => row.reference_name));
}

/** A file's name without its extension, which is what a member would have typed as the title. */
export function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name).trim();
  return (stem.length === 0 ? name.trim() : stem).slice(0, MAX_TITLE_LENGTH);
}

/**
 * The exhibits the files need: an existing one where the file already is an exhibit, otherwise a
 * new one, with a reference name minted against the matter's names AND the names minted earlier in
 * this same batch.
 */
async function exhibitsFor(
  database: SqlDatabase,
  matterId: MatterId,
  files: readonly FolderFileRow[],
  options: ExhibitServiceOptions,
): Promise<{
  exhibitIds: MatterExhibitId[];
  createdIds: MatterExhibitId[];
  statements: SqlStatement[];
}> {
  const existing = await readExhibitsByFile(
    database,
    matterId,
    files.map((file) => file.id),
  );
  const toCreate = files.filter((file) => !existing.has(file.id));
  if (toCreate.length > 0) {
    const count = await countMatterExhibits(database, matterId);
    if (count + toCreate.length > MAX_EXHIBITS_PER_MATTER) {
      throw new ExhibitValidationError(
        "exhibit-bound-exceeded",
        `a matter holds at most ${MAX_EXHIBITS_PER_MATTER} exhibits`,
      );
    }
  }
  const taken =
    toCreate.length > 0 ? await readReferenceNames(database, matterId) : new Set<string>();
  const now = options.clock.now();
  const exhibitIds: MatterExhibitId[] = [];
  const createdIds: MatterExhibitId[] = [];
  const statements: SqlStatement[] = [];
  for (const file of files) {
    const found = existing.get(file.id);
    if (found !== undefined) {
      exhibitIds.push(found);
      continue;
    }
    const title = titleFromFileName(file.name);
    const referenceName = mintReferenceName(referenceNameBaseFor(title), taken);
    taken.add(referenceName);
    const exhibitId = newIdentifier("matterExhibit", options.randomSource);
    statements.push(
      insertMatterExhibitStatement(database, {
        id: exhibitId,
        matter_id: matterId,
        reference_name: referenceName,
        title,
        description: null,
        source_kind: "matterFile",
        file_id: file.id,
        pinned_file_version_id: null,
        page_count: null,
        bates_begin: null,
        bates_end: null,
        created_by: options.actorUserId,
        created_at: now,
      }),
    );
    exhibitIds.push(exhibitId);
    createdIds.push(exhibitId);
  }
  return { exhibitIds, createdIds, statements };
}

export interface CreateSetFromFolderInput {
  readonly matterId: MatterId;
  readonly folderId: FolderId;
  /** Absent takes the folder's name. */
  readonly name?: unknown;
  readonly scheme?: Partial<Record<string, unknown>>;
}

export async function createExhibitSetFromFolder(
  database: SqlDatabase,
  input: CreateSetFromFolderInput,
  options: ExhibitServiceOptions,
): Promise<{ setId: ExhibitSetId; memberIds: ExhibitSetMemberId[]; effect: EffectWrite }> {
  const folder = await requireFolder(database, input.matterId, input.folderId);
  const name = assertSetName(input.name ?? folder.name);
  const scheme = assertScheme({ ...DEFAULT_EXHIBIT_SCHEME, ...input.scheme });
  const files = (await readFolderFiles(database, input.matterId, input.folderId)).filter(
    (file) => file.clean === 1,
  );
  if (files.length > MAX_MEMBERS_PER_SET) {
    throw new ExhibitValidationError(
      "exhibit-bound-exceeded",
      `a set holds at most ${MAX_MEMBERS_PER_SET} exhibits`,
    );
  }
  const { exhibitIds, createdIds, statements } = await exhibitsFor(
    database,
    input.matterId,
    files,
    options,
  );
  const now = options.clock.now();
  const setId = newIdentifier("exhibitSet", options.randomSource);
  const memberIds = exhibitIds.map(() => newIdentifier("exhibitSetMember", options.randomSource));
  return {
    setId,
    memberIds,
    effect: {
      statements: [
        ...statements,
        insertExhibitSetStatement(database, {
          id: setId,
          matterId: input.matterId,
          name,
          scheme,
          continuesFromSetId: null,
          supersedesSetId: null,
          sourceFolderId: input.folderId,
          createdBy: options.actorUserId,
          now,
        }),
        ...exhibitIds.map((exhibitId, index) =>
          appendMemberStatement(database, {
            id: memberIds[index] as ExhibitSetMemberId,
            setId,
            exhibitId,
            now,
          }),
        ),
        domainAuditStatement(database, {
          event: "exhibitSet.createdFromFolder",
          subjectId: setId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: input.matterId,
            folderId: input.folderId,
            exhibitCount: exhibitIds.length,
            createdExhibitIds: createdIds,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

interface FollowedMemberRow {
  readonly id: ExhibitSetMemberId;
  readonly file_id: FileId;
}

export interface FolderFollowResult {
  readonly addedMemberIds: ExhibitSetMemberId[];
  readonly removedMemberIds: ExhibitSetMemberId[];
  readonly effect: EffectWrite;
}

/**
 * Brings a folder-following draft up to date with its folder: files now in the folder with a clean
 * version join at the end, in name order; members whose file has left the folder leave, and the
 * rest close up in the order the member arranged. Nothing to do is an empty effect.
 */
export async function followExhibitSetFolder(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  options: ExhibitServiceOptions,
): Promise<FolderFollowResult> {
  const set = await requireSet(database, matterId, setId);
  assertDraft(set);
  const folderId = set.source_folder_id;
  if (folderId === null) {
    throw new ExhibitValidationError(
      "exhibit-set-not-following",
      "this set was built by hand and follows no folder",
    );
  }
  const files = await readFolderFiles(database, matterId, folderId);
  const { results: members } = await database
    .prepare(
      `SELECT m.id, e.file_id FROM ${EXHIBIT_SET_MEMBER_TABLE} m ` +
        `JOIN ${MATTER_EXHIBIT_TABLE} e ON e.id = m.matter_exhibit_id ` +
        `WHERE m.exhibit_set_id = ?1 ORDER BY m.position`,
    )
    .bind(setId)
    .all<FollowedMemberRow>();

  const inFolder = new Set(files.map((file) => file.id));
  const represented = new Set(members.map((member) => member.file_id));
  const leaving = members.filter((member) => !inFolder.has(member.file_id));
  const staying = members.filter((member) => inFolder.has(member.file_id));
  const joining = files.filter((file) => file.clean === 1 && !represented.has(file.id));
  if (staying.length + joining.length > MAX_MEMBERS_PER_SET) {
    throw new ExhibitValidationError(
      "exhibit-bound-exceeded",
      `a set holds at most ${MAX_MEMBERS_PER_SET} exhibits`,
    );
  }
  if (leaving.length === 0 && joining.length === 0) {
    return {
      addedMemberIds: [],
      removedMemberIds: [],
      effect: { statements: [], outboxMessages: [] },
    };
  }

  const now = options.clock.now();
  const statements: EffectStatement[] = leaving.map((member) =>
    guarded(deleteDraftMemberStatement(database, setId, member.id), DRAFT_SET_GUARD),
  );
  if (leaving.length > 0 && staying.length > 0) {
    // The members that stay close up in their current order. The guard counts the set's rows after
    // the deletes above, so a member added by someone else since the read refuses the batch.
    const { park, settle } = reorderStatements(
      database,
      setId,
      staying.map((member) => member.id),
      now,
    );
    statements.push(guarded(park, ORDER_GUARD), settle);
  }
  const created = await exhibitsFor(database, matterId, joining, options);
  statements.push(...created.statements);
  const addedMemberIds = created.exhibitIds.map(() =>
    newIdentifier("exhibitSetMember", options.randomSource),
  );
  created.exhibitIds.forEach((exhibitId, index) => {
    statements.push(
      appendMemberStatement(database, {
        id: addedMemberIds[index] as ExhibitSetMemberId,
        setId,
        exhibitId,
        now,
      }),
    );
  });
  const removedMemberIds = leaving.map((member) => member.id);
  statements.push(
    domainAuditStatement(database, {
      event: "exhibitSet.folderFollowed",
      subjectId: setId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { matterId, folderId, addedMemberIds, removedMemberIds },
    }),
  );
  return { addedMemberIds, removedMemberIds, effect: { statements, outboxMessages: [] } };
}

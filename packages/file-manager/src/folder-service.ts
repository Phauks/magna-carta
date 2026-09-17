import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FolderId, MatterId } from "@magna-carta/identifiers/types";
import { fileAuditStatement, type AuditContext } from "./audit.ts";
import { selectFolderFileStatement } from "./file-statements.ts";
import {
  deleteFolderStatement,
  insertFolderStatement,
  moveFolderStatement,
  renameFolderStatement,
  selectFolderChildFolderStatement,
  selectFolderIdByNameStatement,
  selectFolderStatement,
} from "./folder-statements.ts";
import { FileManagerValidationError } from "./validation.ts";

export type FolderServiceOptions = AuditContext;

interface StoredFolder {
  readonly id: FolderId;
  readonly matterId: MatterId;
  readonly parentFolderId: FolderId | null;
  readonly name: string;
}

async function loadFolder(database: SqlDatabase, id: FolderId): Promise<StoredFolder | undefined> {
  const { results } = await selectFolderStatement(database, id).all<{
    id: FolderId;
    matter_id: MatterId;
    parent_folder_id: FolderId | null;
    name: string;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    matterId: row.matter_id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
  };
}

// Every path that writes a name applies this: a name that is empty or only whitespace is refused with
// its own code. The per-firm schema carries the same rule as a CHECK, so without this the refusal
// arrives as a raw constraint failure — a 500 for what is plainly a bad request — and only on the
// paths that happen to reach the database at all.
function requireUsableName(name: string): void {
  if (name.trim().length === 0) {
    throw new FileManagerValidationError("invalid-name", "a name cannot be blank");
  }
}

async function assertNameAvailable(
  database: SqlDatabase,
  matterId: MatterId,
  parentFolderId: FolderId | null,
  name: string,
  excludeId?: FolderId,
): Promise<void> {
  const { results } = await selectFolderIdByNameStatement(
    database,
    matterId,
    parentFolderId,
    name,
  ).all<{ id: FolderId }>();
  if (results.some((row) => row.id !== excludeId)) {
    throw new FileManagerValidationError(
      "folder-name-taken",
      `a folder named "${name}" already exists here`,
    );
  }
}

export async function createFolder(
  database: SqlDatabase,
  input: { matterId: MatterId; parentFolderId?: FolderId | null; name: string },
  options: FolderServiceOptions,
): Promise<{ folderId: FolderId; effect: EffectWrite }> {
  requireUsableName(input.name);
  const parentFolderId = input.parentFolderId ?? null;
  if (parentFolderId !== null) {
    // The parent must live in the same matter — a folder tree never spans matters.
    const parent = await loadFolder(database, parentFolderId);
    if (parent === undefined) {
      throw new FileManagerValidationError("unknown-folder", `no such folder: ${parentFolderId}`);
    }
    if (parent.matterId !== input.matterId) {
      throw new FileManagerValidationError(
        "folder-cross-matter",
        "a folder's parent must belong to the same matter",
      );
    }
  }
  await assertNameAvailable(database, input.matterId, parentFolderId, input.name);
  const folderId = newIdentifier("folder", options.randomSource);
  return {
    folderId,
    effect: {
      statements: [
        insertFolderStatement(database, {
          id: folderId,
          matterId: input.matterId,
          parentFolderId,
          name: input.name,
          createdAt: options.clock.now(),
        }),
        fileAuditStatement(database, options, "folder.created", folderId),
      ],
      outboxMessages: [],
    },
  };
}

export async function renameFolder(
  database: SqlDatabase,
  folderId: FolderId,
  name: string,
  options: FolderServiceOptions,
): Promise<{ effect: EffectWrite }> {
  requireUsableName(name);
  const folder = await loadFolder(database, folderId);
  if (folder === undefined) {
    throw new FileManagerValidationError("unknown-folder", `no such folder: ${folderId}`);
  }
  if (name !== folder.name) {
    await assertNameAvailable(database, folder.matterId, folder.parentFolderId, name, folderId);
  }
  return {
    effect: {
      statements: [
        renameFolderStatement(database, folderId, name, options.clock.now()),
        fileAuditStatement(database, options, "folder.renamed", folderId),
      ],
      outboxMessages: [],
    },
  };
}

// Walk the target's ancestor chain: moving F under a descendant of F (or under F itself) would
// detach a subtree into a cycle. D1 has no recursive read mid-batch, so the chain is walked here.
async function wouldCycle(
  database: SqlDatabase,
  folderId: FolderId,
  newParentId: FolderId,
): Promise<boolean> {
  let cursor: FolderId | null = newParentId;
  while (cursor !== null) {
    if (cursor === folderId) return true;
    const ancestor = await loadFolder(database, cursor);
    cursor = ancestor?.parentFolderId ?? null;
  }
  return false;
}

export async function moveFolder(
  database: SqlDatabase,
  folderId: FolderId,
  newParentFolderId: FolderId | null,
  options: FolderServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const folder = await loadFolder(database, folderId);
  if (folder === undefined) {
    throw new FileManagerValidationError("unknown-folder", `no such folder: ${folderId}`);
  }
  if (newParentFolderId !== null) {
    const parent = await loadFolder(database, newParentFolderId);
    if (parent === undefined) {
      throw new FileManagerValidationError(
        "unknown-folder",
        `no such folder: ${newParentFolderId}`,
      );
    }
    if (parent.matterId !== folder.matterId) {
      throw new FileManagerValidationError(
        "folder-cross-matter",
        "a folder's parent must belong to the same matter",
      );
    }
    if (await wouldCycle(database, folderId, newParentFolderId)) {
      throw new FileManagerValidationError(
        "folder-cycle",
        "a folder cannot be moved into itself or one of its descendants",
      );
    }
  }
  await assertNameAvailable(database, folder.matterId, newParentFolderId, folder.name, folderId);
  return {
    effect: {
      statements: [
        guarded(
          moveFolderStatement(database, folderId, newParentFolderId, options.clock.now()),
          "folder.move",
        ),
        fileAuditStatement(database, options, "folder.moved", folderId),
      ],
      outboxMessages: [],
    },
  };
}

export async function deleteFolder(
  database: SqlDatabase,
  folderId: FolderId,
  options: FolderServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const folder = await loadFolder(database, folderId);
  if (folder === undefined) {
    throw new FileManagerValidationError("unknown-folder", `no such folder: ${folderId}`);
  }
  const childFolder = await selectFolderChildFolderStatement(database, folderId).all();
  const childFile = await selectFolderFileStatement(database, folderId).all();
  if (childFolder.results.length > 0 || childFile.results.length > 0) {
    throw new FileManagerValidationError(
      "folder-not-empty",
      "a folder must be empty before it can be deleted",
    );
  }
  return {
    effect: {
      statements: [
        deleteFolderStatement(database, folderId),
        fileAuditStatement(database, options, "folder.deleted", folderId),
      ],
      outboxMessages: [],
    },
  };
}

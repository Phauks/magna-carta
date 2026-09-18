/*
 * The row model every view on this surface renders through. One shape for a folder row and a file
 * row, because they share a table: a folder is exactly as tall as a file, sorts in the same
 * columns, and answers the same questions — its Size reads bytes and count, its Date Modified is
 * the most recent modification beneath it, and its Safety is the worst word true of its contents.
 *
 * Pure: no DOM, no fetch. The aggregates a real matter cannot answer instantly are computed here
 * and shown as they arrive; the surface renders the field immediately either way, never hidden.
 */
import type { FolderSummary } from "./folder-api.ts";
import type { MatterFile } from "./matter-file-api.ts";
import { worstSafetyKey, type SafetyKey } from "./file-manager-vocabulary.ts";

/**
 * A row's key. The prefix is what tells the two kinds apart in one flat selection set, and it is
 * the same prefix across every view so a selection survives a change of view without translation.
 */
export const FOLDER_KEY_PREFIX = "folder:";
export const FILE_KEY_PREFIX = "file:";

export type FileManagerRow =
  | { readonly kind: "folder"; readonly key: string; readonly folder: FolderSummary }
  | { readonly kind: "file"; readonly key: string; readonly file: MatterFile };

export function folderKey(folderId: string): string {
  return FOLDER_KEY_PREFIX + folderId;
}

export function fileKey(fileId: string): string {
  return FILE_KEY_PREFIX + fileId;
}

export function rowKeyOf(row: FileManagerRow): string {
  return row.key;
}

/** The row's own name, before the extension setting is applied. */
export function rowName(row: FileManagerRow): string {
  return row.kind === "folder" ? row.folder.name : row.file.name;
}

/**
 * An index of the matter's folders and files, built once per read. Every aggregate below walks it
 * rather than re-filtering the flat lists, so a deep tree costs one pass instead of one per folder.
 */
export class MatterFileIndex {
  readonly folders: readonly FolderSummary[];
  readonly documents: readonly MatterFile[];
  private readonly childFolders = new Map<string | null, FolderSummary[]>();
  private readonly folderFiles = new Map<string | null, MatterFile[]>();
  private readonly foldersById = new Map<string, FolderSummary>();

  constructor(folders: readonly FolderSummary[], documents: readonly MatterFile[]) {
    this.folders = folders;
    this.documents = documents;
    for (const folder of folders) {
      this.foldersById.set(folder.id, folder);
      const siblings = this.childFolders.get(folder.parentFolderId) ?? [];
      siblings.push(folder);
      this.childFolders.set(folder.parentFolderId, siblings);
    }
    for (const document of documents) {
      const held = this.folderFiles.get(document.folderId) ?? [];
      held.push(document);
      this.folderFiles.set(document.folderId, held);
    }
  }

  folderById(folderId: string): FolderSummary | undefined {
    return this.foldersById.get(folderId);
  }

  /** Folders directly under a parent, in name order (case-insensitive). */
  childrenOf(parentFolderId: string | null): readonly FolderSummary[] {
    return (this.childFolders.get(parentFolderId) ?? []).toSorted((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
  }

  /** Files sitting directly in a folder. */
  filesIn(folderId: string | null): readonly MatterFile[] {
    return this.folderFiles.get(folderId) ?? [];
  }

  /** Every file anywhere beneath a folder, the folder's own included. */
  subtreeFiles(folderId: string | null): readonly MatterFile[] {
    const collected: MatterFile[] = [...this.filesIn(folderId)];
    for (const child of this.childrenOf(folderId)) collected.push(...this.subtreeFiles(child.id));
    return collected;
  }

  /** How many folders sit anywhere beneath this one. */
  descendantFolderIds(folderId: string): readonly string[] {
    const collected: string[] = [];
    for (const child of this.childrenOf(folderId)) {
      collected.push(child.id, ...this.descendantFolderIds(child.id));
    }
    return collected;
  }

  /** Root-first ancestors, ending with the folder itself. Empty at the matter root. */
  pathTo(folderId: string | null): readonly FolderSummary[] {
    const path: FolderSummary[] = [];
    const seen = new Set<string>();
    let current = folderId === null ? undefined : this.foldersById.get(folderId);
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current);
      current =
        current.parentFolderId === null ? undefined : this.foldersById.get(current.parentFolderId);
    }
    return path;
  }

  /** The folder's path as the Location column and the search results read it. */
  pathText(folderId: string | null): string {
    const named = this.pathTo(folderId).map((folder) => folder.name);
    return named.length === 0 ? "Home" : named.join(" / ");
  }
}

/** A folder's aggregates. Every field may be pending, which the cell renders rather than hides. */
export interface FolderAggregate {
  readonly fileCount: number;
  readonly folderCount: number;
  readonly totalBytes: number | null;
  readonly latestModified: string | null;
  readonly safety: SafetyKey;
}

export function folderAggregate(
  index: MatterFileIndex,
  folderId: string,
  safetyOf: (document: MatterFile) => SafetyKey,
): FolderAggregate {
  const files = index.subtreeFiles(folderId);
  // A file still being checked has no size yet. Summing it as zero would understate the folder, so
  // an unknown size makes the whole total unknown rather than quietly wrong.
  const anyUnknown = files.some((file) => file.sizeBytes === null);
  const totalBytes = anyUnknown
    ? null
    : files.reduce((running, file) => running + (file.sizeBytes ?? 0), 0);
  const latestModified = files.reduce<string | null>(
    (latest, file) => (latest === null || file.updatedAt > latest ? file.updatedAt : latest),
    null,
  );
  return {
    fileCount: files.length,
    folderCount: index.descendantFolderIds(folderId).length,
    totalBytes,
    latestModified,
    safety: worstSafetyKey(files.map((file) => safetyOf(file))),
  };
}

/** Human size: whole bytes below a kilobyte, one decimal at the natural unit above it. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** A folder's Size cell reads bytes AND count: "4.6 GB · 13 files". */
export function folderSizeText(aggregate: FolderAggregate): string {
  const count = `${aggregate.fileCount} file${aggregate.fileCount === 1 ? "" : "s"}`;
  if (aggregate.totalBytes === null) return count;
  return `${formatBytes(aggregate.totalBytes)} · ${count}`;
}

/**
 * The kind words this surface's row models use for a PLACE. The browse list, the search results
 * and the upload intake say "folder"; inside an archive the format's own word is "directory", and
 * an archive listing is a list of places and the things in them exactly like the others.
 */
type PlaceKind = "folder" | "directory";

/**
 * Folders lead, files follow, and the reader's sort orders each run on its own.
 *
 * Which kind a row is is a fact about the LIST rather than a value in one of its columns: a folder
 * is a place and a file is a thing inside it, so they are two runs with a boundary between them,
 * not two values that a sort direction can interleave. Sorting by name backwards reverses the
 * names WITHIN each run and never lifts a file over a folder; the same holds for size, for a date,
 * and for a column added next year.
 *
 * The comparator is the grid's own, handed straight through, which is why no column is named here.
 * Reimplementing the column comparison — or special-casing the name column, which is the shape
 * this rule is usually asked for in — would give the list a second ordering rule to disagree with
 * the header it is sorted by.
 *
 * Pinning is untouched: it is the reader's own arranging and the grid applies it after this, so a
 * pinned file still leads the list from above the folders.
 */
export function orderFolderRowsFirst<TRow extends { readonly kind: PlaceKind | "file" }>(
  rows: readonly TRow[],
  compare: (left: TRow, right: TRow) => number,
): TRow[] {
  const folders = rows.filter((row) => row.kind !== "file").toSorted(compare);
  const files = rows.filter((row) => row.kind === "file").toSorted(compare);
  return [...folders, ...files];
}

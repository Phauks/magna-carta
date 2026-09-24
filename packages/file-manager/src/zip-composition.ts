import type { FileId, FileVersionId, FolderId } from "@magna-carta/identifiers/types";
import { disambiguate } from "./bundle-paths.ts";
import type { ExportCopyFacts } from "./export-copy.ts";
import type { BundleOptions } from "./bundle-options.ts";
import type { FolderNode, MatterCleanFile } from "./queries.ts";

// Pure composition for the bulk-ZIP download: resolves a {folderIds, fileIds} selection over a
// matter's clean files to a version-pinned set of archive entries, and composes each entry's path
// from the folder tree. No I/O — the route fetches the matter's folders and clean files (the
// status-gated reads in queries.ts), then hands them here. Keeping it pure makes the path logic and
// the selection rules unit-testable without Miniflare, and guarantees a pending/quarantined/deleted
// version can never enter the archive (the caller only ever passes already-clean files).

export interface ZipEntry {
  readonly path: string;
  readonly fileId: FileId;
  readonly versionId: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number;
  // The version's export copy, when it has one: the route swaps the copy's key and size in for the
  // stored object's before any lane reads the entry, so a bundle never carries a document's marks.
  readonly exportCopy: ExportCopyFacts;
}

export interface ZipSelection {
  // Absent matterId is rejected by the route's schema; the resolver works over one matter's files.
  readonly folderIds?: readonly FolderId[];
  readonly fileIds?: readonly FileId[];
}

// The folder-tree path of a folder: its ancestor names joined by "/", root-most first. A broken
// parent link (a parent absent from the map) stops the walk — the partial path is still a valid,
// collision-free archive location. A self/ancestor cycle cannot occur (moveFolder refuses it), but
// a visited-guard keeps the walk total regardless.
function folderPath(folderId: FolderId, byId: ReadonlyMap<FolderId, FolderNode>): string[] {
  const segments: string[] = [];
  const visited = new Set<FolderId>();
  let cursor: FolderId | null = folderId;
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const node: FolderNode | undefined = byId.get(cursor);
    if (node === undefined) break;
    segments.push(node.name);
    cursor = node.parentFolderId;
  }
  return segments.toReversed();
}

// The archive path for a file: its folder's tree path plus the file name. Files at the matter root
// (folderId null) sit at the archive root. A name collision within one folder is disambiguated by
// suffixing " (n)" before any extension, so two same-named files never overwrite in the archive.
function fileEntryPath(
  folderId: FolderId | null,
  name: string,
  byId: ReadonlyMap<FolderId, FolderNode>,
): string {
  const folderSegments = folderId === null ? [] : folderPath(folderId, byId);
  return [...folderSegments, name].join("/");
}

// Descendant-folder closure of the selected folders: a selected folder pulls in every file beneath
// it, at any depth. Walks parent links from each folder up to a selected ancestor.
function folderIsSelected(
  folderId: FolderId,
  selected: ReadonlySet<FolderId>,
  byId: ReadonlyMap<FolderId, FolderNode>,
): boolean {
  const visited = new Set<FolderId>();
  let cursor: FolderId | null = folderId;
  while (cursor !== null && !visited.has(cursor)) {
    if (selected.has(cursor)) return true;
    visited.add(cursor);
    cursor = byId.get(cursor)?.parentFolderId ?? null;
  }
  return false;
}

export interface ResolvedZip {
  readonly entries: readonly ZipEntry[];
  readonly fileCount: number;
  readonly totalBytes: number;
}

// Resolves the selection to archive entries over the matter's clean files. An empty selection
// (no folderIds and no fileIds) means the whole matter. A file is included when it is named directly,
// or it sits in a selected folder (or any descendant of one). Entries are sorted by path for a
// deterministic archive, with name collisions disambiguated.
export function resolveZipSelection(
  selection: ZipSelection,
  folders: readonly FolderNode[],
  cleanFiles: readonly MatterCleanFile[],
): ResolvedZip {
  const byId = new Map<FolderId, FolderNode>(folders.map((folder) => [folder.id, folder]));
  const selectedFolders = new Set<FolderId>(selection.folderIds ?? []);
  const selectedFiles = new Set<FileId>(selection.fileIds ?? []);
  const wholeMatter = selectedFolders.size === 0 && selectedFiles.size === 0;

  const chosen = cleanFiles.filter((file) => {
    if (wholeMatter) return true;
    if (selectedFiles.has(file.fileId)) return true;
    return file.folderId !== null && folderIsSelected(file.folderId, selectedFolders, byId);
  });

  const taken = new Set<string>();
  const entries = chosen
    .map((file) => ({ file, path: fileEntryPath(file.folderId, file.name, byId) }))
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ file, path }) => ({
      path: disambiguate(path, taken),
      fileId: file.fileId,
      versionId: file.versionId,
      r2Key: file.r2Key,
      sizeBytes: file.sizeBytes ?? 0,
      exportCopy: {
        exportCopyState: file.exportCopyState,
        exportR2Key: file.exportR2Key,
        exportSizeBytes: file.exportSizeBytes,
      },
    }));

  const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  return { entries, fileCount: entries.length, totalBytes };
}

// The content-addressed key for a built bundle: a hex SHA-256 over the sorted `r2Key\tpath` lines of
// the selection. Sorting makes it order-independent, so the same set of version-pinned entries always
// hashes the same regardless of resolve order; any change to the set, an r2Key, or a path changes it.
// The route uses it both to dedup identical concurrent builds and as the R2 object key for the artifact.
export async function bundleManifestHash(
  entries: readonly { r2Key: string; path: string }[],
): Promise<string> {
  const canonical = [...entries]
    .map((entry) => `${entry.r2Key}\t${entry.path}`)
    .toSorted()
    .join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The cache/dedup key for an OPTIONED bundle: the content manifest hash folded together with the
// non-secret options that change the output bytes. Two exclusions: `encryption` is omitted because
// encrypted bundles are never cached (their output is non-deterministic and the password must not
// enter any persisted key); `outputName` is omitted because it is a display/Content-Disposition
// name that does not affect the archive bytes, so identical content with different display names
// shares one cached artifact.
export async function bundleCacheKey(
  entries: readonly { r2Key: string; path: string }[],
  options: BundleOptions,
): Promise<string> {
  const optionSignature = JSON.stringify({
    format: options.format,
    compression: options.compression,
    split: options.split,
    wrapperFolder: options.wrapperFolder,
    layout: options.layout,
    manifest: options.manifest,
  });
  const contentHash = await bundleManifestHash(entries);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${contentHash}\n${optionSignature}`),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

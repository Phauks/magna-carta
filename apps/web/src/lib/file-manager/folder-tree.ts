import type { TreeNode } from "@magna-carta/design-system/tree";
import type { FolderSummary } from "./folder-api.ts";

/*
 * The pure shape of a matter's folders: the flat adjacency list the server returns, turned into the
 * nested form the Tree renders, plus the path lookups the breadcrumb and the "move here" checks
 * need. Kept out of the components so the awkward cases — an orphan whose parent is missing, a
 * cycle, a folder that is its own ancestor — are unit-testable without a DOM.
 */

/** Folders under one parent, in name order. Case-insensitive, so "Zoning" does not precede "answers". */
export function childrenOf(
  folders: readonly FolderSummary[],
  parentFolderId: string | null,
): FolderSummary[] {
  return folders
    .filter((folder) => folder.parentFolderId === parentFolderId)
    .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * The flat list as a Tree. A folder whose parent is not in the list is NOT dropped: it is treated as
 * a root, because a folder the reader cannot see is still somewhere they can put things, and
 * silently hiding it would lose files.
 */
export function toTreeNodes(folders: readonly FolderSummary[]): TreeNode[] {
  const known = new Set(folders.map((folder) => folder.id));
  const parentOf = (folder: FolderSummary) =>
    folder.parentFolderId !== null && known.has(folder.parentFolderId)
      ? folder.parentFolderId
      : null;

  const build = (parentFolderId: string | null, seen: ReadonlySet<string>): TreeNode[] =>
    folders
      .filter((folder) => parentOf(folder) === parentFolderId && !seen.has(folder.id))
      .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((folder) => {
        // A cycle in the data would otherwise recurse until the stack gives out. Carrying the
        // ancestors down means a folder can appear at most once on any path.
        const children = build(folder.id, new Set([...seen, folder.id]));
        return children.length > 0
          ? { id: folder.id, label: folder.name, children }
          : { id: folder.id, label: folder.name };
      });

  return build(null, new Set());
}

/** Root-first ancestors of a folder, ending with the folder itself. Empty at the matter root. */
export function pathTo(
  folders: readonly FolderSummary[],
  folderId: string | null,
): FolderSummary[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: FolderSummary[] = [];
  const seen = new Set<string>();
  let current = folderId === null ? undefined : byId.get(folderId);
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentFolderId === null ? undefined : byId.get(current.parentFolderId);
  }
  return path;
}

/** Every ancestor id of a folder — what the tree has to expand to reveal it. */
export function ancestorIds(folders: readonly FolderSummary[], folderId: string | null): string[] {
  return pathTo(folders, folderId)
    .slice(0, -1)
    .map((folder) => folder.id);
}

/**
 * Whether `candidate` sits inside `folderId` (or is it). A folder cannot be moved into its own
 * subtree — that detaches the whole branch from the matter, and nothing downstream would notice.
 */
export function isWithin(
  folders: readonly FolderSummary[],
  candidate: string,
  folderId: string,
): boolean {
  return pathTo(folders, candidate).some((folder) => folder.id === folderId);
}

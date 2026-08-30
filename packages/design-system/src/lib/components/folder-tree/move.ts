/*
 * Whether one folder can be dragged into another — a pure question about the shape of the tree,
 * kept out of the component so the awkward cases are testable without a pointer.
 *
 * Three refusals, and each one is a different kind of wrong:
 *   - into ITSELF, which is not a move at all;
 *   - into its OWN DESCENDANT, which detaches the whole branch from the matter and leaves it
 *     reachable from nowhere — the one that actually loses documents;
 *   - into the folder it is ALREADY in, which would write a move nobody made, and put an entry on
 *     the history and the undo stack for a gesture with no effect.
 */
import type { FolderTreeNode } from "./types.ts";

/** Every folder inside `folderId`, at any depth. Empty when the folder is not in the tree. */
export function descendantIdentifiers(
  folders: readonly FolderTreeNode[],
  folderId: string,
): Set<string> {
  const found = new Set<string>();
  const collect = (nodes: readonly FolderTreeNode[]): void => {
    for (const node of nodes) {
      found.add(node.id);
      if (node.children) collect(node.children);
    }
  };
  const locate = (nodes: readonly FolderTreeNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === folderId) {
        if (node.children) collect(node.children);
        return true;
      }
      if (node.children && locate(node.children)) return true;
    }
    return false;
  };
  locate(folders);
  return found;
}

/**
 * The folder holding `folderId`, or `null` when it sits at the root. A folder that is not in the
 * tree also answers `null`: it has no parent to compare a destination against either.
 */
export function parentIdentifier(
  folders: readonly FolderTreeNode[],
  folderId: string,
): string | null {
  const walk = (
    nodes: readonly FolderTreeNode[],
    parent: string | null,
  ): { parent: string | null } | undefined => {
    for (const node of nodes) {
      if (node.id === folderId) return { parent };
      if (node.children) {
        const found = walk(node.children, node.id);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return walk(folders, null)?.parent ?? null;
}

/** Whether dragging `folderId` onto `destinationFolderId` (null for the root) is a real move. */
export function canMoveFolder(
  folders: readonly FolderTreeNode[],
  folderId: string,
  destinationFolderId: string | null,
): boolean {
  if (destinationFolderId === folderId) return false;
  if (
    destinationFolderId !== null &&
    descendantIdentifiers(folders, folderId).has(destinationFolderId)
  ) {
    return false;
  }
  return parentIdentifier(folders, folderId) !== destinationFolderId;
}

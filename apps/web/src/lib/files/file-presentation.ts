/*
 * The file surface's pure presentation logic — the decisions every view shares, kept out of the
 * components so they are unit-testable without a DOM and so four views cannot drift into four
 * answers for the same question.
 *
 * The server returns folders as a FLAT list (id, parentFolderId, name); the tree and the breadcrumb
 * path are composed here. Both walks are defensive about a parent that does not resolve: the server
 * cycle-checks on write, but a client that trusted that and looped would hang the tab rather than
 * degrade, so an unresolvable parent is treated as a root and a cycle terminates.
 */
import type { FileSummary, FolderSummary } from "@magna-carta/api-client";
import type { TreeNode } from "@magna-carta/design-system/tree";
import type { BadgeVariant } from "@magna-carta/design-system/badge";

/** Human-readable size: whole bytes below 1 KB, otherwise one decimal at the natural unit. */
export function formatFileSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return "—";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kilobytes = sizeBytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(1)} GB`;
}

/**
 * The folder tree, root nodes first, each level sorted by name — the shape the design system's Tree
 * takes. A folder whose parent is not in the list surfaces at the root rather than vanishing: a
 * folder the member cannot navigate to is worse than one shown a level too high.
 */
export function buildFolderTree(folders: readonly FolderSummary[]): TreeNode[] {
  const childrenByParent = new Map<string | null, FolderSummary[]>();
  const known = new Set(folders.map((folder) => folder.id));
  for (const folder of folders) {
    // An unresolvable parent (or a parent that is the folder itself) is re-seated at the root.
    const parent =
      folder.parentFolderId !== null &&
      folder.parentFolderId !== folder.id &&
      known.has(folder.parentFolderId)
        ? folder.parentFolderId
        : null;
    const siblings = childrenByParent.get(parent);
    if (siblings === undefined) childrenByParent.set(parent, [folder]);
    else siblings.push(folder);
  }

  // `visiting` bounds the descent: a cycle among folders (which the server forbids, but which a
  // client must not hang on) stops at the repeated node instead of recursing forever.
  const visiting = new Set<string>();
  const build = (parentId: string | null): TreeNode[] => {
    const children = childrenByParent.get(parentId) ?? [];
    return children
      .filter((folder) => !visiting.has(folder.id))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((folder) => {
        visiting.add(folder.id);
        const descendants = build(folder.id);
        visiting.delete(folder.id);
        return descendants.length > 0
          ? { id: folder.id, label: folder.name, children: descendants }
          : { id: folder.id, label: folder.name };
      });
  };
  return build(null);
}

/**
 * The ancestry of a folder, root first, ending at the folder itself — the breadcrumb's spine.
 * An unknown folder id yields an empty path (the caller renders just the matter root), and a cycle
 * terminates rather than looping.
 */
export function folderAncestry(
  folders: readonly FolderSummary[],
  folderId: string | null,
): FolderSummary[] {
  if (folderId === null) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: FolderSummary[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(folderId);
  while (cursor !== undefined && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentFolderId === null ? undefined : byId.get(cursor.parentFolderId);
  }
  return path;
}

/**
 * How a file's ingest outcome reads on the surface, or `null` for the ordinary clean file — the
 * common case wears no chip, so the two that need attention are the only ones that carry one.
 *
 * A quarantined file is shown, deliberately: a file the scanner rejected must say so where the
 * member dropped it, not vanish. It has no current version, so no view can offer its bytes.
 */
export interface FileStatusPresentation {
  readonly label: string;
  readonly variant: BadgeVariant;
  /** The quarantine reason, when the server gave one — shown beside the chip. */
  readonly detail: string | null;
}

export function fileStatusPresentation(file: FileSummary): FileStatusPresentation | null {
  if (file.status === "pending") {
    return { label: "Processing", variant: "info", detail: null };
  }
  if (file.status === "quarantined") {
    return { label: "Rejected", variant: "danger", detail: file.quarantineReason };
  }
  return null;
}

/** Whether the file has committed, clean bytes behind it — the gate on every content affordance. */
export function hasReadableContent(file: FileSummary): boolean {
  return file.status === "clean" && file.currentVersionId !== null;
}

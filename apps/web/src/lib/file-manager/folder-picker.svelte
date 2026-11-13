<script lang="ts">
  /*
   * Choosing a folder — the one picker every destination question uses: where an upload lands, and
   * where a folder's contents go when the folder around it is deleted.
   *
   * It is the design system's FolderTree, not a second tree: the same rows, the same twisties, the
   * same Home-as-first-row shape the rail has, so picking a destination is navigating the exact
   * structure the reader already knows. The flat indented list this replaces crammed the whole
   * matter into a few rows with no way to fold anything.
   *
   * A picker can EXCLUDE a subtree, which is what keeps a folder from being asked to move inside
   * itself: the excluded folder and everything beneath it are simply not offered.
   */
  import FolderTree from "@magna-carta/design-system/folder-tree";
  import type { FolderTreeNode } from "@magna-carta/design-system/folder-tree";
  import type { MatterFileIndex } from "./file-rows.ts";

  let {
    index,
    chosenFolderId = $bindable(null),
    excludeFolderId = null,
    label = "Choose a folder",
    disabled = false,
  }: {
    index: MatterFileIndex;
    /** The folder chosen, or null for the matter root. */
    chosenFolderId?: string | null;
    /** A folder whose whole subtree is not a legal destination. */
    excludeFolderId?: string | null;
    label?: string;
    /** Locked: the choice has been acted on and the tree no longer takes a press. Still shown. */
    disabled?: boolean;
  } = $props();

  const excluded = $derived(
    excludeFolderId === null
      ? new Set<string>()
      : new Set([excludeFolderId, ...index.descendantFolderIds(excludeFolderId)]),
  );

  const treeNodes = $derived.by((): FolderTreeNode[] => {
    const build = (parentFolderId: string | null): FolderTreeNode[] =>
      index
        .childrenOf(parentFolderId)
        .filter((folder) => !excluded.has(folder.id))
        .map((folder) => {
          const children = build(folder.id);
          const node: FolderTreeNode = { id: folder.id, label: folder.name };
          return children.length > 0 ? { ...node, children } : node;
        });
    return build(null);
  });

  // The picker starts with every folder open: a destination should be one click away, and the
  // reader folds what they do not need rather than unfolding what they do.
  let expandedFolderIds = $state<string[]>([]);
  let seeded = false;
  $effect(() => {
    if (seeded) return;
    const withChildren: string[] = [];
    const walk = (nodes: readonly FolderTreeNode[]): void => {
      for (const node of nodes) {
        if (node.children !== undefined && node.children.length > 0) {
          withChildren.push(node.id);
          walk(node.children);
        }
      }
    };
    walk(treeNodes);
    if (withChildren.length > 0 || treeNodes.length > 0) {
      expandedFolderIds = withChildren;
      seeded = true;
    }
  });
</script>

<div
  class="mc-scrollbar overflow-y-auto rounded-md border border-border-default"
  style="max-block-size: min(calc(var(--mc-size-sidebar) + var(--mc-space-64)), 50vh)"
  inert={disabled}
  aria-disabled={disabled ? "true" : undefined}
>
  <FolderTree
    folders={treeNodes}
    bind:selectedFolderId={chosenFolderId}
    bind:expandedFolderIds
    showFileCounts={false}
    {label}
    homeLabel="Home"
    emptyMessage="No folders yet. Everything is at the top level."
    newFolderDisabledReason="Folders are made from the file list, not from this picker."
  />
</div>

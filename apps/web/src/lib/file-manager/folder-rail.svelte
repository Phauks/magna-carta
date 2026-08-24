<script lang="ts">
  /*
   * The folder rail: Home, the matter's folder tree, and the one control that makes a new folder.
   *
   * Home is a button, not a tree node. The matter root is not a folder — nothing can be renamed,
   * coloured or moved about it — and giving it a treeitem would put an entry in the keyboard model
   * that half the tree's actions do not apply to.
   */
  import Tree from "@magna-carta/design-system/tree";
  import Button from "@magna-carta/design-system/button";
  import House from "@lucide/svelte/icons/house";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import type { FolderSummary } from "./folder-api.ts";
  import { toTreeNodes } from "./folder-tree.ts";

  let {
    folders,
    currentFolderId = $bindable(),
    expandedIds = $bindable([]),
    onNewFolder,
  }: {
    folders: readonly FolderSummary[];
    /** The folder being shown, or null at the matter root. */
    currentFolderId: string | null;
    expandedIds: string[];
    onNewFolder: () => void;
  } = $props();

  const nodes = $derived(toTreeNodes(folders));
  // The Tree takes `undefined` for "nothing selected"; null is this screen's word for the root, and
  // conflating the two would leave Home and a folder looking selected at once.
  const selectedId = $derived(currentFolderId ?? undefined);
</script>

<nav class="flex h-full flex-col gap-4 overflow-y-auto p-8" aria-label="Folders">
  <div class="flex items-center gap-4">
    <Button
      variant={currentFolderId === null ? "secondary" : "ghost"}
      size="sm"
      class="flex-1 justify-start"
      aria-current={currentFolderId === null ? "true" : undefined}
      onclick={() => (currentFolderId = null)}
    >
      <House class="size-14" aria-hidden="true" />
      Home
    </Button>
    <Button variant="ghost" size="sm" aria-label="New folder" title="New folder" onclick={onNewFolder}>
      <FolderPlus class="size-14" aria-hidden="true" />
    </Button>
  </div>

  {#if folders.length > 0}
    <Tree
      items={nodes}
      bind:expandedIds
      {selectedId}
      label="Matter folders"
      onSelect={(id: string) => (currentFolderId = id)}
    />
  {:else}
    <p class="p-8 text-xs text-text-muted">
      No folders yet. Everything on this matter sits at the top level until one is made.
    </p>
  {/if}
</nav>

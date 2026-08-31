<script lang="ts">
  /*
   * Choosing a folder — the one picker every destination question uses: where an upload lands, and
   * where a folder's contents go when the folder around them is deleted.
   *
   * Home is the picker's FIRST ROW rather than a separate radio beside it, because the matter root
   * is a destination like any other and splitting it out made two controls out of one decision.
   *
   * A picker can EXCLUDE a subtree, which is what keeps a folder from being asked to move inside
   * itself: the excluded folder and everything beneath it are simply not offered.
   */
  import Button from "@magna-carta/design-system/button";
  import Folder from "@lucide/svelte/icons/folder";
  import Check from "@lucide/svelte/icons/check";
  import { FOLDER_TREE_HOME_ICON } from "@magna-carta/design-system/folder-tree";
  import type { FolderSummary } from "./folder-api.ts";
  import type { MatterFileIndex } from "./file-rows.ts";

  let {
    index,
    chosenFolderId = $bindable(null),
    excludeFolderId = null,
    label = "Choose a folder",
  }: {
    index: MatterFileIndex;
    /** The folder chosen, or null for the matter root. */
    chosenFolderId?: string | null;
    /** A folder whose whole subtree is not a legal destination. */
    excludeFolderId?: string | null;
    label?: string;
  } = $props();

  const HomeIcon = FOLDER_TREE_HOME_ICON;

  const excluded = $derived(
    excludeFolderId === null
      ? new Set<string>()
      : new Set([excludeFolderId, ...index.descendantFolderIds(excludeFolderId)]),
  );

  interface PickerRow {
    readonly folder: FolderSummary;
    readonly depth: number;
  }

  /** The tree flattened in reading order, so one keyboard pass walks it top to bottom. */
  const rows = $derived.by((): PickerRow[] => {
    const collected: PickerRow[] = [];
    const walk = (parentFolderId: string | null, depth: number): void => {
      for (const folder of index.childrenOf(parentFolderId)) {
        if (excluded.has(folder.id)) continue;
        collected.push({ folder, depth });
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 0);
    return collected;
  });

  /** Indentation is a spacing step per level, applied as padding on the row's own control. */
  const INDENT_CLASSES = ["ps-8", "ps-16", "ps-24", "ps-32", "ps-40", "ps-48"];
  const indentOf = (depth: number): string =>
    INDENT_CLASSES[Math.min(depth, INDENT_CLASSES.length - 1)] ?? "ps-8";
</script>

<div
  class="mc-scrollbar flex max-h-96 flex-col gap-4 overflow-y-auto rounded-md border border-border-default p-4"
  role="listbox"
  aria-label={label}
>
  <Button
    variant={chosenFolderId === null ? "secondary" : "ghost"}
    size="sm"
    class="justify-start ps-8"
    role="option"
    aria-selected={chosenFolderId === null}
    onclick={() => (chosenFolderId = null)}
  >
    <HomeIcon class="size-16" aria-hidden="true" />
    Home
    {#if chosenFolderId === null}
      <Check class="ms-auto size-16" aria-hidden="true" />
    {/if}
  </Button>
  {#each rows as row (row.folder.id)}
    <Button
      variant={chosenFolderId === row.folder.id ? "secondary" : "ghost"}
      size="sm"
      class="justify-start {indentOf(row.depth + 1)}"
      role="option"
      aria-selected={chosenFolderId === row.folder.id}
      onclick={() => (chosenFolderId = row.folder.id)}
    >
      <Folder class="size-16" aria-hidden="true" />
      {row.folder.name}
      {#if chosenFolderId === row.folder.id}
        <Check class="ms-auto size-16" aria-hidden="true" />
      {/if}
    </Button>
  {/each}
</div>

<script lang="ts">
  /*
   * The rail: the conversations the surface lists, in the order the reader chose.
   *
   * THE ORDER IS THE SERVER'S. The control at the head asks the listing for the order, and the rail
   * draws what comes back; it never re-orders the page it holds, because an order applied to what
   * happens to be loaded is not the order (docs/conventions/magnus-rulings.md, R1). The control is
   * there in the empty state too: a rail with nothing in it still shows how it would be ordered
   * rather than conjuring the control with the first conversation (R2).
   *
   * WITH A SHELF, THE RAIL IS SECTIONS THAT FOLD (R2.12): Pinned first, whose rows are duplicates
   * that stay in their folders too; then the member's folders, folded until opened; then General,
   * which is every conversation in no folder. A closed section's caret points right. Each section is
   * its own read in the chosen order, so none of them is a page sorted on the client. Without a shelf
   * (a search, or a matter's own section) the rail is one list of the whole record.
   *
   * The rail owns no frame. The surface around it decides whether it stands as a column or sits
   * under a switcher; this component is the sections, the order control, and the folder controls.
   */
  import { buttonClasses } from "@magna-carta/design-system/button";
  import Button from "@magna-carta/design-system/button";
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import ArrowUpDown from "@lucide/svelte/icons/arrow-up-down";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { ConversationSort, MagnusConversation, MagnusFolder } from "./magnus-api.ts";
  import { CONVERSATION_SORT_LABELS, offeredSorts, sortControlLabel } from "./magnus-vocabulary.ts";
  import ConversationRows from "./conversation-rows.svelte";
  import {
    GENERAL_SECTION,
    PINNED_SECTION,
    type ConversationShelf,
  } from "./conversation-shelf.svelte.ts";
  import FolderDeleteDialog from "./folder-delete-dialog.svelte";
  import FolderNameDialog from "./folder-name-dialog.svelte";

  let {
    rows,
    selectedId,
    sort = $bindable("date"),
    onMatter = false,
    matterTitleFor,
    nextCursor = null,
    loadingMore = false,
    emptyLine,
    shelf,
    onSelect,
    onSortChange,
    onLoadMore,
    onFolderRemoved,
  }: {
    /**
     * The rows to draw: with a shelf, General's; without one, the whole list. An empty list is the
     * empty record; the loading state is the surface's.
     */
    rows: readonly MagnusConversation[];
    selectedId: string | null;
    /** The order the rows are in. Bindable, and every change is a fresh read at the caller. */
    sort?: ConversationSort;
    /** True inside a matter, where ordering by matter would order by nothing. */
    onMatter?: boolean;
    /** The matter a row cites beneath its name, or null where it cites none. */
    matterTitleFor?: (matterId: string) => string | null;
    nextCursor?: string | null;
    loadingMore?: boolean;
    /** What the rail says when the record is empty. */
    emptyLine: string;
    /** The member's folders and pins. Absent draws one list rather than sections. */
    shelf?: ConversationShelf;
    onSelect: (conversationId: string) => void;
    onSortChange: (sort: ConversationSort) => void;
    onLoadMore?: () => void;
    /** A folder was removed, so General holds what it held and is read again. */
    onFolderRemoved?: () => void;
  } = $props();

  const sorts = $derived(offeredSorts({ onMatter }));
  const pinnedRows = $derived(shelf?.pinned.items ?? []);

  let naming = $state(false);
  let renamingFolder = $state<MagnusFolder | null>(null);
  let removing = $state(false);
  let removingFolder = $state<MagnusFolder | null>(null);

  function chooseSort(value: string): void {
    const chosen = sorts.find((candidate) => candidate === value);
    if (chosen === undefined || chosen === sort) return;
    sort = chosen;
    onSortChange(chosen);
  }

  function newFolder(): void {
    renamingFolder = null;
    naming = true;
  }

  function renameFolder(folder: MagnusFolder): void {
    renamingFolder = folder;
    naming = true;
  }

  function removeFolder(folder: MagnusFolder): void {
    removingFolder = folder;
    removing = true;
  }
</script>

<div class="flex flex-col gap-8">
  <!-- The order control leads the rail and never leaves it. A menu rather than a row of buttons:
       three words on one control cost one line, and the chosen one reads on the control itself. -->
  <div class="flex items-center justify-between gap-8">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonClasses({ variant: "ghost", size: "sm" })}
        aria-label={sortControlLabel(sort)}
      >
        <ArrowUpDown class="size-16" aria-hidden="true" />
        {sortControlLabel(sort)}
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" style="min-inline-size: var(--mc-size-popover)">
        <DropdownMenu.RadioGroup value={sort} onValueChange={chooseSort}>
          {#each sorts as candidate (candidate)}
            <DropdownMenu.RadioItem value={candidate}>
              {CONVERSATION_SORT_LABELS[candidate]}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    {#if shelf !== undefined}
      <Button variant="ghost" size="sm" onclick={newFolder}>
        <FolderPlus class="size-16" aria-hidden="true" />
        Add Folder
      </Button>
    {/if}
  </div>

  {#if shelf === undefined}
    <ConversationRows
      {rows}
      {selectedId}
      label="Your conversations with Magnus"
      {matterTitleFor}
      {nextCursor}
      {loadingMore}
      {emptyLine}
      {onSelect}
      {onLoadMore}
    />
  {:else}
    <Accordion.Root
      type="multiple"
      value={shelf.openSections}
      onValueChange={(value) => shelf.setOpen(value)}
    >
      <!-- Pinned stands only when something is pinned: an empty section at the head of every rail
           would be a heading over nothing for every member who never pins. -->
      {#if pinnedRows.length > 0}
        <Accordion.Item value={PINNED_SECTION}>
          <Accordion.Trigger chevron="start">Pinned</Accordion.Trigger>
          <Accordion.Content>
            <ConversationRows
              rows={pinnedRows}
              {selectedId}
              label="Pinned conversations"
              {matterTitleFor}
              nextCursor={shelf.pinned.nextCursor}
              loadingMore={shelf.pinned.loadingMore}
              emptyLine=""
              {onSelect}
              onLoadMore={() => void shelf.loadMore(PINNED_SECTION)}
            />
          </Accordion.Content>
        </Accordion.Item>
      {/if}

      {#each shelf.folders ?? [] as folder (folder.id)}
        {@const list = shelf.listFor(folder.id)}
        <Accordion.Item value={folder.id}>
          <div class="flex items-center gap-4">
            <Accordion.Trigger chevron="start" class="min-w-0 flex-1">
              <span class="truncate">{folder.name}</span>
            </Accordion.Trigger>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
                aria-label={`More about the folder ${folder.name}`}
              >
                <EllipsisVertical class="size-16" aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item onSelect={() => renameFolder(folder)}>
                  <PencilLine class="size-16 shrink-0" aria-hidden="true" />
                  Rename
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => removeFolder(folder)}>
                  <Trash2 class="size-16 shrink-0" aria-hidden="true" />
                  Remove Folder
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
          <Accordion.Content>
            {#if list.items === null && list.failure === null}
              <p class="text-sm text-text-muted">Reading this folder.</p>
            {:else if list.failure !== null}
              <p class="text-sm text-text-muted">{list.failureMessage}</p>
            {:else}
              <ConversationRows
                rows={list.items ?? []}
                {selectedId}
                label={`Conversations in ${folder.name}`}
                {matterTitleFor}
                nextCursor={list.nextCursor}
                loadingMore={list.loadingMore}
                emptyLine="Nothing in this folder yet. Move a conversation here from its menu."
                markPinned
                {onSelect}
                onLoadMore={() => void shelf.loadMore(folder.id)}
              />
            {/if}
          </Accordion.Content>
        </Accordion.Item>
      {/each}

      <Accordion.Item value={GENERAL_SECTION}>
        <Accordion.Trigger chevron="start">General</Accordion.Trigger>
        <Accordion.Content>
          <ConversationRows
            {rows}
            {selectedId}
            label="Conversations in General"
            {matterTitleFor}
            {nextCursor}
            {loadingMore}
            {emptyLine}
            markPinned
            {onSelect}
            {onLoadMore}
          />
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>

    {#if shelf.folderFailure !== null}
      <p class="text-sm text-text-muted">Your folders could not be read.</p>
    {/if}

    <FolderNameDialog bind:open={naming} {shelf} folder={renamingFolder} />
    <FolderDeleteDialog
      bind:open={removing}
      {shelf}
      folder={removingFolder}
      onRemoved={() => onFolderRemoved?.()}
    />
  {/if}
</div>

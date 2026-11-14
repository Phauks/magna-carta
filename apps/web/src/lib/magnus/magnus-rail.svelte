<script lang="ts">
  /*
   * The rail: the conversations the surface lists, in the order the reader chose. It is the owner's
   * board (round 2) in full: the screen's name with a split New beside it, a search, the three
   * orders as one segmented control, and sections that fold.
   *
   * THE ORDER IS THE SERVER'S. The segmented control asks the listing for the order, and the rail
   * draws what comes back; it never re-orders the page it holds, because an order applied to what
   * happens to be loaded is not the order (docs/conventions/magnus-rulings.md, R1). The control is
   * there in the empty state too (R2).
   *
   * WITH A SHELF, THE RAIL IS SECTIONS THAT FOLD (R2.12): Pinned first, whose rows are duplicates
   * that stay in their folders too; then Folders, each folder folding on its own; then the
   * conversations in no folder under headings the order gives them (magnus-vocabulary.ts,
   * `railDateGroup`). A heading only labels a run of rows the server already ordered. A closed
   * section's caret points right. Without a shelf (a search, or a matter's own section) the rail is
   * one list of the whole record.
   */
  import type { Snippet } from "svelte";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import Button from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import CreateControl from "@magna-carta/design-system/create-control";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { ConversationSort, MagnusConversation, MagnusFolder } from "./magnus-api.ts";
  import { CONVERSATION_SORT_LABELS, offeredSorts, railDateGroup } from "./magnus-vocabulary.ts";
  import ConversationRows from "./conversation-rows.svelte";
  import { PINNED_SECTION, type ConversationShelf } from "./conversation-shelf.svelte.ts";
  import FolderDeleteDialog from "./folder-delete-dialog.svelte";
  import FolderNameDialog from "./folder-name-dialog.svelte";

  let {
    rows,
    selectedId,
    sort = $bindable("date"),
    onMatter = false,
    matterNumberFor,
    matterLineFor,
    nextCursor = null,
    loadingMore = false,
    emptyLine,
    shelf,
    search,
    newRefusal,
    onNew,
    onSelect,
    onSortChange,
    onLoadMore,
    onFolderRemoved,
  }: {
    /**
     * The rows to draw: with a shelf, the conversations in no folder; without one, the whole list.
     * An empty list is the empty record; the loading state is the surface's.
     */
    rows: readonly MagnusConversation[];
    selectedId: string | null;
    /** The order the rows are in. Bindable, and every change is a fresh read at the caller. */
    sort?: ConversationSort;
    /** True inside a matter, where ordering by matter would order by nothing. */
    onMatter?: boolean;
    /** The number of the matter a row is kept on, for the line under its name. */
    matterNumberFor?: (matterId: string) => string | null;
    /** The matter as its number and name, for a heading under the matter order. */
    matterLineFor?: (matterId: string) => string | null;
    nextCursor?: string | null;
    loadingMore?: boolean;
    /** What the rail says when the record is empty. */
    emptyLine: string;
    /** The member's folders and pins. Absent draws one list rather than sections. */
    shelf?: ConversationShelf;
    /** The search field, which the surface owns because it owns the read the search narrows. */
    search?: Snippet;
    /** Why New cannot start a conversation now, or undefined while it can. */
    newRefusal?: string | undefined;
    /** Start a new conversation. Absent draws no head (a matter's section has its own). */
    onNew?: () => void;
    onSelect: (conversationId: string) => void;
    onSortChange: (sort: ConversationSort) => void;
    onLoadMore?: () => void;
    /** A folder was removed, so the conversations it held are read again. */
    onFolderRemoved?: () => void;
  } = $props();

  const sorts = $derived(offeredSorts({ onMatter }));
  const pinnedRows = $derived(shelf?.pinned.items ?? []);
  const folders = $derived(shelf?.folders ?? []);
  /* Read once per render of the rail: a row says a time of day only for today. */
  const now = $derived.by(() => {
    void rows;
    return new Date();
  });

  /*
   * The headings over the conversations in no folder, each holding a run of consecutive rows. Under
   * the date order a heading is the day the run started on; under the name order there is one; under
   * the matter order one per matter.
   */
  const groups = $derived.by(() => {
    const runs: { label: string; rows: MagnusConversation[] }[] = [];
    for (const row of rows) {
      const label =
        sort === "date"
          ? railDateGroup(row.createdAt, now)
          : sort === "name" || shelf === undefined
            ? "Not in a Folder"
            : row.matterId === null
              ? "General"
              : (matterLineFor?.(row.matterId) ?? "A matter");
      const last = runs.at(-1);
      if (last !== undefined && last.label === label) last.rows.push(row);
      else runs.push({ label, rows: [row] });
    }
    return runs;
  });

  /* Which headings the reader folded. A heading not named here is open. */
  let folded = $state<Record<string, boolean>>({});
  let foldersOpen = $state(true);

  let naming = $state(false);
  let renamingFolder = $state<MagnusFolder | null>(null);
  let removing = $state(false);
  let removingFolder = $state<MagnusFolder | null>(null);

  function chooseSort(next: ConversationSort): void {
    if (next === sort) return;
    sort = next;
    onSortChange(next);
  }

  function sectionOpen(section: string): boolean {
    return shelf?.openSections.includes(section) ?? false;
  }

  function toggleSection(section: string): void {
    if (shelf === undefined) return;
    const open = shelf.openSections;
    shelf.setOpen(
      open.includes(section) ? open.filter((value) => value !== section) : [...open, section],
    );
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

{#snippet caret(open: boolean)}
  {#if open}
    <ChevronDown class="size-12 shrink-0" aria-hidden="true" />
  {:else}
    <ChevronRight class="size-12 shrink-0" aria-hidden="true" />
  {/if}
{/snippet}

{#snippet heading(label: string, count: number | null, open: boolean, toggle: () => void)}
  <button
    type="button"
    class="mt-8 flex w-full items-center gap-4 rounded-md px-12 py-4 text-text-muted hover:bg-surface-sunken hover:text-text-default"
    aria-expanded={open}
    onclick={toggle}
  >
    {@render caret(open)}
    <FieldLabel as="span" class="min-w-0 flex-1 truncate text-start">{label}</FieldLabel>
    {#if count !== null}
      <span class="text-xs">{count}</span>
    {/if}
  </button>
{/snippet}

<div class="flex min-w-0 flex-col gap-8">
  {#if onNew !== undefined}
    <div class="flex items-center justify-between gap-8">
      <Masthead.Title class="text-xl">Magnus</Masthead.Title>
      <!-- New, as the board draws it: one press opens the things the rail can make. -->
      <CreateControl
        title="Start a conversation with Magnus."
        refusal={newRefusal}
        onpress={shelf === undefined ? onNew : undefined}
        choices={shelf === undefined
          ? undefined
          : [
              { label: "New Conversation", icon: MessageSquarePlus, onselect: () => onNew?.() },
              { label: "New Folder", icon: FolderPlus, onselect: newFolder },
            ]}
      />
    </div>
  {/if}

  {@render search?.()}

  <!-- The three orders as one segmented control: each is one press, and the chosen one reads on
       the control. -->
  <div
    class="flex gap-2 rounded-md bg-surface-sunken p-2"
    role="radiogroup"
    aria-label="Order conversations by"
  >
    {#each sorts as candidate (candidate)}
      <button
        type="button"
        role="radio"
        aria-checked={candidate === sort}
        class="flex-1 rounded-sm px-4 py-4 text-xs whitespace-nowrap text-text-muted aria-checked:bg-surface-raised aria-checked:font-semibold aria-checked:text-text-default aria-checked:shadow-elevation-1"
        onclick={() => chooseSort(candidate)}
      >
        {candidate === "matter" ? "Matter #" : CONVERSATION_SORT_LABELS[candidate]}
      </button>
    {/each}
  </div>

  {#if shelf === undefined}
    <ConversationRows
      {rows}
      {selectedId}
      label="Your conversations with Magnus"
      {matterNumberFor}
      {now}
      {nextCursor}
      {loadingMore}
      {emptyLine}
      {onSelect}
      {onLoadMore}
    />
  {:else}
    <div class="flex min-w-0 flex-col">
      <!-- Pinned stands only when something is pinned: an empty section at the head of every rail
           would be a heading over nothing for every member who never pins. -->
      {#if pinnedRows.length > 0}
        {@const open = sectionOpen(PINNED_SECTION)}
        {@render heading(
          "Pinned",
          shelf.pinned.nextCursor === null ? pinnedRows.length : null,
          open,
          () => toggleSection(PINNED_SECTION),
        )}
        {#if open}
          <ConversationRows
            rows={pinnedRows}
            {selectedId}
            label="Pinned conversations"
            {matterNumberFor}
            {now}
            nextCursor={shelf.pinned.nextCursor}
            loadingMore={shelf.pinned.loadingMore}
            emptyLine=""
            {onSelect}
            onLoadMore={() => void shelf.loadMore(PINNED_SECTION)}
          />
        {/if}
      {/if}

      {#if folders.length > 0}
        {@render heading("Folders", null, foldersOpen, () => (foldersOpen = !foldersOpen))}
        {#if foldersOpen}
          {#each folders as folder (folder.id)}
            {@const read = shelf.peek(folder.id)}
            {@const open = sectionOpen(folder.id)}
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-4 rounded-md px-12 py-4 text-sm font-semibold hover:bg-surface-sunken"
                aria-expanded={open}
                onclick={() => toggleSection(folder.id)}
              >
                {@render caret(open)}
                <Folder class="size-16 shrink-0 text-accent-default" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-start">{folder.name}</span>
                {#if read !== undefined && read.items !== null && read.nextCursor === null}
                  <span class="text-xs font-normal text-text-muted">{read.items.length}</span>
                {/if}
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
                  aria-label={`More about the folder ${folder.name}`}
                >
                  <EllipsisVertical class="size-16" aria-hidden="true" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
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
            {#if open}
              {@const list = shelf.listFor(folder.id)}
              <div class="ms-16 border-s border-border-default ps-8">
                {#if list.items === null && list.failure === null}
                  <p class="px-12 py-4 text-sm text-text-muted">Reading this folder.</p>
                {:else if list.failure !== null}
                  <p class="px-12 py-4 text-sm text-text-muted">{list.failureMessage}</p>
                {:else}
                  <ConversationRows
                    rows={list.items ?? []}
                    {selectedId}
                    label={`Conversations in ${folder.name}`}
                    {matterNumberFor}
                    {now}
                    nextCursor={list.nextCursor}
                    loadingMore={list.loadingMore}
                    emptyLine="Nothing here yet. Move a conversation here from its menu."
                    markPinned
                    {onSelect}
                    onLoadMore={() => void shelf.loadMore(folder.id)}
                  />
                {/if}
              </div>
            {/if}
          {/each}
        {/if}
      {/if}

      {#each groups as group, index (`${group.label}:${String(index)}`)}
        {@const open = folded[group.label] !== true}
        {@render heading(
          group.label,
          group.rows.length,
          open,
          () => (folded = { ...folded, [group.label]: open }),
        )}
        {#if open}
          <ConversationRows
            rows={group.rows}
            {selectedId}
            label={`Conversations: ${group.label}`}
            {matterNumberFor}
            {now}
            emptyLine=""
            markPinned
            {onSelect}
          />
        {/if}
      {/each}
      {#if rows.length === 0 && emptyLine !== ""}
        <p class="px-12 py-8 text-sm text-text-muted">{emptyLine}</p>
      {/if}
      {#if nextCursor !== null && onLoadMore !== undefined}
        <Button variant="ghost" size="sm" disabled={loadingMore} onclick={onLoadMore}>
          Show More Conversations
        </Button>
      {/if}
    </div>

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

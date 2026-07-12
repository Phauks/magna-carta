<script lang="ts">
  /*
   * Matter Files — the first HOST of the shared file surface. The host owns three things and only
   * three: where the files come from (the typed reads below), the chrome above the body (the
   * breadcrumb, the view switch, the folder toggle), and the confidentiality boundary — these are
   * filed, versioned matter files, not the Tools workbench's ephemeral ones. The body itself (the
   * collection region and its four interchangeable views) is host-agnostic, which is what lets the
   * Tools inspector reuse it with a different source and a different set of capabilities.
   *
   * The current folder lives in the URL (`?folder=`), not in a rune: that makes a folder a real
   * address — the back button walks back out of it, and a link to a folder opens in it — and it is
   * what the breadcrumb's links are built from.
   *
   * Root shows EVERY file in the matter rather than only the loose ones, because the contract cannot
   * express "no folder": `files.list` filters by folder id when given one and is otherwise unfiltered.
   * "All files" is the honest reading of that, and it is also the more useful root.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { createInfiniteQuery, createQuery } from "@tanstack/svelte-query";
  import { filesListInfiniteOptions, foldersListOptions } from "@magna-carta/api-client";
  import type { FileSummary } from "@magna-carta/api-client";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Breadcrumb from "@magna-carta/design-system/breadcrumb";
  import type { BreadcrumbEntry } from "@magna-carta/design-system/breadcrumb";
  import Tree from "@magna-carta/design-system/tree";
  import FolderTree from "@lucide/svelte/icons/folder-tree";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import GalleryVerticalEnd from "@lucide/svelte/icons/gallery-vertical-end";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import { createViewShell } from "$lib/view-shell/view-shell.svelte.ts";
  import type { RegionDefinition, ViewDefinition } from "$lib/view-shell/view-shell-types.ts";
  import ViewSwitch from "$lib/view-shell/view-switch.svelte";
  import ViewShellBody from "$lib/view-shell/view-shell-body.svelte";
  import {
    filesRegionsPreference,
    filesViewPreference,
  } from "$lib/files/files-view-preference.svelte.ts";
  import { FOLDERS_REGION_ID, type FilesView } from "$lib/files/files-view-preference.ts";
  import { buildFolderTree, folderAncestry } from "$lib/files/file-presentation.ts";
  import {
    defaultDirectionFor,
    FILE_SORT_KEYS,
    FILE_SORT_LABELS,
    parseFileSortDirection,
    parseFileSortKey,
    sortAfterHeadingClick,
    type FileSort,
    type FileSortKey,
  } from "$lib/files/file-sort.ts";
  import type { FilesViewContext } from "$lib/files/files-view-context.ts";
  import FilesListView from "$lib/files/files-list-view.svelte";
  import FilesTilesView from "$lib/files/files-tiles-view.svelte";
  import FilesGalleryView from "$lib/files/files-gallery-view.svelte";
  import type { MatterFixture } from "$lib/matters/fixtures.ts";

  let { data }: { data: { matter: MatterFixture } } = $props();

  const matterId = $derived(data.matter.id);
  const folderId = $derived(page.url.searchParams.get("folder"));

  // The sort lives in the URL beside the folder, for the same reasons: it is shareable, the back
  // button walks out of it, and a reload lands on the order you were reading. Both readers are TOTAL,
  // so a hand-edited `?sort=` cannot put the page into a state the server would reject.
  const sort = $derived<FileSort>({
    key: parseFileSortKey(page.url.searchParams.get("sort")),
    direction: parseFileSortDirection(page.url.searchParams.get("direction")),
  });

  const foldersQuery = createQuery(() => foldersListOptions({ query: { matterId } }));

  // The generated infinite options bring the query function and key; the paging policy is the
  // consumer's. The first page carries an OBJECT page param rather than a cursor string: the
  // generated query function reads a string param as `cursor`, so an empty string would put a bare
  // `cursor=` on the wire and ask the server to decode nothing. The object is merged OVER the base
  // query, so naming `matterId` (which the page-param type requires) re-states it without dropping
  // the folder filter or the status include beside it.
  const filesQuery = createInfiniteQuery(() => ({
    ...filesListInfiniteOptions({
      query: {
        matterId,
        ...(folderId === null ? {} : { folderId }),
        // The SERVER sorts. It orders the whole matter and returns a page of that order, so the
        // answer is the same whether one page is loaded or ten — ordering the rows already in hand
        // would report the largest file of the page, not of the matter. The sort is part of the query
        // key, so changing it re-runs the listing from its first page (a cursor is only meaningful
        // under the sort it was minted with).
        sort: sort.key,
        direction: sort.direction,
        // Pending and quarantined rows are included by design: a file the scanner rejected must say
        // so where the member dropped it, rather than silently never appearing.
        includePendingAndQuarantined: "true" as const,
      },
    }),
    initialPageParam: { query: { matterId } },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  }));

  const folders = $derived(foldersQuery.data?.data ?? []);
  const files = $derived<FileSummary[]>(
    filesQuery.data?.pages.flatMap((entry) => entry.data) ?? [],
  );
  const folderNodes = $derived(buildFolderTree(folders));
  const ancestry = $derived(folderAncestry(folders, folderId));

  const breadcrumbEntries = $derived<BreadcrumbEntry[]>([
    { label: "All files", href: `/matters/${matterId}/files` },
    ...ancestry.map((folder) => ({
      label: folder.name,
      href: `/matters/${matterId}/files?folder=${folder.id}`,
    })),
  ]);

  const views: ViewDefinition<FileSummary, FilesView, FilesViewContext>[] = [
    { id: "list", label: "List view", icon: List, view: FilesListView },
    { id: "tiles", label: "Tile view", icon: LayoutGrid, view: FilesTilesView },
    { id: "gallery", label: "Gallery view", icon: GalleryVerticalEnd, view: FilesGalleryView },
  ];

  const regions: RegionDefinition[] = [
    { id: FOLDERS_REGION_ID, label: "Folders", icon: FolderTree, defaultShown: true },
  ];

  const shell = createViewShell({
    views,
    activeViewPreference: filesViewPreference,
    items: () => files,
    itemKey: (file) => file.id,
    regions,
    regionsPreference: filesRegionsPreference,
    // Every view gets the sort, not just the table — a grid ordered newest-first is the chronology.
    context: (): FilesViewContext => ({ sort, onSortByColumn }),
  });

  // Expansion is the member's, so it is not derived from the path — but opening a folder should not
  // leave its own ancestors shut, or the tree would show a selected node nobody can see.
  let expandedFolderIds = $state<string[]>([]);
  $effect(() => {
    const required = ancestry.map((folder) => folder.id);
    const missing = required.filter((id) => !expandedFolderIds.includes(id));
    if (missing.length > 0) expandedFolderIds = [...expandedFolderIds, ...missing];
  });

  /** The current address with one search parameter changed — so a sort keeps the folder, and vice versa. */
  function addressWith(changes: Record<string, string | null>): string {
    const parameters = new URLSearchParams(page.url.searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) parameters.delete(key);
      else parameters.set(key, value);
    }
    const query = parameters.toString();
    return `/matters/${matterId}/files${query === "" ? "" : `?${query}`}`;
  }

  async function openFolder(nextFolderId: string | null): Promise<void> {
    // A folder change is real navigation, not a filter: the selection belongs to what was on screen,
    // so it does not survive the move.
    shell.selection.clear();
    await goto(addressWith({ folder: nextFolderId }), { keepFocus: true, noScroll: true });
  }

  /**
   * Re-sorting is NOT navigation — it is the same set of files in a different order, so the selection
   * survives it (a member who picked three files and then sorted by size still has those three).
   */
  async function applySort(next: FileSort): Promise<void> {
    await goto(addressWith({ sort: next.key, direction: next.direction }), {
      keepFocus: true,
      noScroll: true,
    });
  }

  /** A table heading: the column in force reverses, another switches to its natural direction. */
  function onSortByColumn(key: FileSortKey): void {
    void applySort(sortAfterHeadingClick(sort, key));
  }

  /**
   * The menu only CHOOSES the column — re-picking the one already in force must not secretly reverse
   * it, because a menu item that reads "Name" should mean "sort by name", not "flip". Direction is the
   * arrow button's job, which is the one control whose whole purpose is to say which way.
   */
  function onChooseSortKey(key: FileSortKey): void {
    if (key === sort.key) return;
    void applySort({ key, direction: defaultDirectionFor(key) });
  }

  const showFolders = $derived(shell.isRegionShown(FOLDERS_REGION_ID));
  const isLoading = $derived(filesQuery.isPending || foldersQuery.isPending);
</script>

<svelte:head>
  <title>Files · {data.matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <div class="flex items-center justify-between gap-16 border-b border-border-strong pb-8">
    <Breadcrumb items={breadcrumbEntries} label="Folder path" />
    <div class="flex items-center gap-8">
      <!-- The sort sits in the chrome, not in the table, because it belongs to every view: the grid
           views sort too, and a grid ordered newest-first is the chronology. The table's headings are
           a second way into the same state, not a separate one. -->
      <DropdownMenu.Root>
        <!-- The trigger IS the button (it carries no look of its own), so it wears the button recipe
             rather than wrapping one — a button inside a button is inoperable. -->
        <DropdownMenu.Trigger class={buttonClasses({ variant: "ghost", size: "default" })}>
          Sort: {FILE_SORT_LABELS[sort.key]}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.RadioGroup
            value={sort.key}
            onValueChange={(key: string) => onChooseSortKey(key as FileSortKey)}
          >
            {#each FILE_SORT_KEYS as key (key)}
              <DropdownMenu.RadioItem value={key}>{FILE_SORT_LABELS[key]}</DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Button
        variant="ghost"
        size="icon"
        aria-label={sort.direction === "asc" ? "Sorted ascending" : "Sorted descending"}
        onclick={() => applySort({ key: sort.key, direction: sort.direction === "asc" ? "desc" : "asc" })}
      >
        {#if sort.direction === "asc"}
          <ArrowUp class="size-16" aria-hidden="true" />
        {:else}
          <ArrowDown class="size-16" aria-hidden="true" />
        {/if}
      </Button>
      <Button
        variant={showFolders ? "secondary" : "ghost"}
        size="icon"
        aria-label="Folders"
        aria-pressed={showFolders}
        onclick={() => shell.toggleRegion(FOLDERS_REGION_ID)}
      >
        <FolderTree class="size-16" aria-hidden="true" />
      </Button>
      <ViewSwitch controller={shell} label="Choose a view" />
    </div>
  </div>

  {#if filesQuery.isError || foldersQuery.isError}
    <Alert.Root variant="danger">
      <Alert.Title>This matter's files could not be loaded</Alert.Title>
      <Alert.Description>
        The record is intact — only this view failed. Reload to try again.
      </Alert.Description>
    </Alert.Root>
  {:else}
    <div class="flex gap-24">
      {#if showFolders}
        <!-- A quarter of the body, and it does not shrink: the tree is a fixed landmark, not a
             column that collapses as the table grows. The width is a FRACTION rather than a spacing
             step because the spacing scale tops out well below a usable tree width — asking for one
             (min-w-160) silently falls off the token scale and resolves to 640px. -->
        <aside class="w-1/4 shrink-0">
          {#if folderNodes.length > 0}
            <Tree
              items={folderNodes}
              label="Folders"
              bind:expandedIds={expandedFolderIds}
              selectedId={folderId ?? undefined}
              onSelect={(id) => openFolder(id)}
            />
          {:else if !foldersQuery.isPending}
            <p class="text-xs text-text-muted">This matter has no folders yet.</p>
          {/if}
        </aside>
      {/if}

      <div class="min-w-0 flex-1">
        {#if isLoading}
          <div class="flex flex-col gap-8" aria-busy="true">
            {#each { length: 5 } as _, index (index)}
              <Skeleton class="h-32 w-full" />
            {/each}
          </div>
        {:else if files.length === 0}
          <EmptyState title="No files here">
            Every document the firm holds for this matter lands here — each version kept, each byte's
            integrity recorded.
          </EmptyState>
        {:else}
          <ViewShellBody controller={shell} />

          {#if filesQuery.hasNextPage}
            <div class="mt-16 flex justify-center">
              <Button
                variant="secondary"
                disabled={filesQuery.isFetchingNextPage}
                onclick={() => filesQuery.fetchNextPage()}
              >
                {filesQuery.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</section>

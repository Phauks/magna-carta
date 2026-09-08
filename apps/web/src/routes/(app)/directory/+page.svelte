<script lang="ts">
  /*
   * The Directory — the firm's one book of the people and organizations it deals with, and the List
   * archetype's landing for them.
   *
   * ITS RESTING STATE IS THE INDEX. Every practice-management system lists its contacts, and a firm
   * that has entered twenty clients expects to open this screen and see twenty. So not-searching
   * shows the firm's own directory: a real enumeration, in name order, walked a page at a time, with
   * the size of the whole record stated beside it. This screen previously answered that with an
   * instruction to start typing, which told a working person their records were not there.
   *
   * THE INDEX AND THE SEARCH ARE DIFFERENT OBJECTS AND THE SCREEN SHOWS THAT. The distinction the
   * old resting state was protecting is real and is kept: a ranked search returns its best matches,
   * not all of them, so it must never be dressed as an index — and a listing faked by searching for
   * a common letter would be exactly that, an accident presented as the firm's record. What changes
   * is that the two are now built as the two things they are:
   *
   *   - The INDEX is sorted, filterable, paged, and counted. It is the platform's one table, so its
   *     columns sort and narrow the way every other list on the product does.
   *   - The SEARCH ANSWER is in the firm's own relevance order, is NOT re-sorted here, and says so
   *     when it is capped. Sorting a capped answer would put the best of an arbitrary slice at the
   *     top and read as the best of the firm's record. It takes three characters to ask, because the
   *     corpus matches three-character windows and a shorter query can match nothing at all.
   *
   * Both kinds sit in ONE listing. A person and an organization are two entries in the same book,
   * and a reader looking for "Pemberton" does not know in advance which the firm filed. Kind is a
   * column and a filter, never a second screen.
   *
   * TWO HONEST LIMITS. The index is cursor-paged, so the column sort and the column filters run over
   * what has been loaded rather than over the whole firm; the count beside the table is what keeps
   * that readable. And a record folded into another by a merge is not listed — its names still
   * answer a search and still resolve to the survivor, but listing it beside that survivor would
   * show one client as two.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Separator from "@magna-carta/design-system/separator";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleOrganization, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import Building2 from "@lucide/svelte/icons/building-2";
  import ListFilter from "@lucide/svelte/icons/list-filter";
  import CreateControl from "@magna-carta/design-system/create-control";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Search from "@lucide/svelte/icons/search";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import { goto, replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { untrack } from "svelte";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import {
    listDirectoryEntities,
    searchDirectory,
    DIRECTORY_EDIT_PERMISSION,
    type DirectoryEntityKind,
    type DirectoryEntityListing,
    type DirectorySearchHit,
  } from "$lib/directory/directory-api.ts";
  import { isAskableQuery, MINIMUM_QUERY_LENGTH } from "$lib/directory/directory-search.ts";
  import {
    directoryListingColumns,
    listingKindLabel,
    listingKindParameter,
    listingName,
    DEFAULT_LISTING_KIND,
    DIRECTORY_LISTING_INITIAL_SORT,
    LISTING_KIND_ITEMS,
    type DirectoryListingKind,
  } from "$lib/directory/directory-listing.ts";
  import {
    entityRecordFromAddress,
    entityRecordHref,
    searchHitKindLabel,
    RECORD_PARAMETER,
  } from "$lib/directory/entity-presentation.ts";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import EntityWindow from "$lib/directory/entity-window.svelte";
  import NewOrganizationDialog from "$lib/directory/new-organization-dialog.svelte";
  import NewPersonDialog from "$lib/directory/new-person-dialog.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  // ---- who is asking ---------------------------------------------------------------------------

  let session = $state<SessionBootstrap | null>(null);
  let bootstrapped = $state(false);

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  const mayEdit = $derived(session?.permissions.includes(DIRECTORY_EDIT_PERMISSION) ?? false);
  const createDisabledReason = $derived(
    session === null
      ? "Reading your session."
      : mayEdit
        ? undefined
        : permissionRefusal("Adding to the directory", "directory:edit"),
  );

  // ---- what the screen is being asked -----------------------------------------------------------

  let typed = $state("");
  let asked = $state("");
  let searchOpen = $state(false);
  let searchField = $state<HTMLInputElement | null>(null);
  let kind = $state<DirectoryListingKind>(DEFAULT_LISTING_KIND);

  // The typed query settles before it is sent: one request per keystroke asks the firm's record a
  // question nobody has finished asking.
  $effect(() => {
    const query = typed;
    const timer = setTimeout(() => (asked = query), 300);
    return () => clearTimeout(timer);
  });

  // The field opens where the icon was, so the gesture that revealed it also puts the caret in it.
  $effect(() => {
    if (searchOpen) searchField?.focus();
  });

  function toggleSearch(): void {
    if (searchOpen && typed !== "") {
      // A live search is what the control is for, so the first press on an open field clears it
      // rather than hiding a narrowing the reader can then no longer see.
      typed = "";
      return;
    }
    searchOpen = !searchOpen;
  }

  const searching = $derived(isAskableQuery(asked));
  // Typed, but not yet enough to ask. The index stays on screen and one line says what is missing,
  // rather than the screen silently doing nothing while somebody types.
  const tooShortToAsk = $derived(!searching && typed.trim() !== "");

  // ---- the index -------------------------------------------------------------------------------

  const list = new PagedList<DirectoryEntityListing>("The firm's directory could not be read.");
  const records = $derived(list.items);
  const listFailure = $derived(list.failure);
  let total = $state(0);
  let reloadToken = $state(0);

  // A change of kind is a different question, so it is a different read.
  const listSubject = $derived(`${kind}|${String(reloadToken)}`);

  function readPage(cursor?: string) {
    return listDirectoryEntities(fetch, { kind: listingKindParameter(kind), cursor });
  }

  // The whole-record count travels on every page, so it is taken from whichever page last landed
  // rather than cached from the first: a record created while somebody is on page three is counted.
  async function readFirstPage(): Promise<void> {
    await list.load(async (cursor) => {
      const outcome = await readPage(cursor);
      if (outcome.kind === "ok") total = outcome.value.total;
      return outcome;
    });
  }

  $effect(() => {
    const subject = listSubject;
    if (list.showing(subject)) return;
    list.reset(subject);
    // The count belongs to the question that was asked. Carrying the old one across a change of
    // kind would print "everyone" beside a page of organizations.
    total = 0;
    void readFirstPage();
  });

  function loadMore(): void {
    void list.loadMore(async (cursor) => {
      const outcome = await readPage(cursor);
      if (outcome.kind === "ok") total = outcome.value.total;
      return outcome;
    });
  }

  function rereadIndex(): void {
    reloadToken += 1;
  }

  const grid = DataTable.createDataTableGrid<DirectoryEntityListing>({
    columns: () => directoryListingColumns(),
    rows: () => records ?? [],
    rowKey: (row) => row.entityId,
    initialSort: DIRECTORY_LISTING_INITIAL_SORT,
    itemNoun: { singular: "record", plural: "records" },
    // Double-click and Enter open the record. The name stays a real link beside it, so the
    // browser's own gestures still work; nobody has to hit the link precisely.
    onActivate: (row) => void goto(entityRecordHref(row.entityId)),
  });

  const narrowed = $derived(kind !== DEFAULT_LISTING_KIND || grid.activeFilterCount > 0);
  const narrowingSummary = $derived(
    kind === DEFAULT_LISTING_KIND
      ? grid.activeFilterLabels.join(", ")
      : [listingKindLabel(kind), ...grid.activeFilterLabels].join(", "),
  );
  // The count only needs stating while the page on screen is not the whole record.
  const moreThanLoaded = $derived(total > (records?.length ?? 0));

  function showEveryone(): void {
    kind = DEFAULT_LISTING_KIND;
    grid.clearAllFilters();
  }

  // ---- the search answer -----------------------------------------------------------------------

  let hits = $state<readonly DirectorySearchHit[] | null>(null);
  let capped = $state(false);
  let searchFailure = $state<StatedFailure | null>(null);
  let searchToken = $state(0);

  /**
   * The shape the answer takes while the directory is being searched: the same rows the real
   * answer renders, over the sample vocabulary, both kinds. Not anybody the firm holds.
   */
  const HIT_FIXTURE: readonly DirectorySearchHit[] = [
    {
      entityId: "fixture-1",
      entityKind: "person",
      displayName: samplePerson(0).name,
      matchedName: samplePerson(0).name,
      matchedNameRole: "current",
      matchedNameIsCurrent: true,
      relevance: 0,
    },
    {
      entityId: "fixture-2",
      entityKind: "organization",
      displayName: sampleOrganization(1).name,
      matchedName: sampleOrganization(1).name,
      matchedNameRole: "current",
      matchedNameIsCurrent: true,
      relevance: 0,
    },
    {
      entityId: "fixture-3",
      entityKind: "person",
      displayName: samplePerson(1).name,
      matchedName: samplePerson(1).name,
      matchedNameRole: "current",
      matchedNameIsCurrent: true,
      relevance: 0,
    },
  ];

  function searchAgain(): void {
    searchToken += 1;
  }

  $effect(() => {
    const query = asked.trim();
    void searchToken;
    if (!isAskableQuery(query)) {
      hits = null;
      capped = false;
      searchFailure = null;
      return;
    }
    let cancelled = false;
    hits = null;
    searchFailure = null;
    void (async () => {
      const outcome = await searchDirectory(fetch, query);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        hits = outcome.value.data;
        capped = outcome.value.capped;
        return;
      }
      hits = [];
      capped = false;
      searchFailure = stated(outcome.failure, "The directory could not be searched.");
    })();
    return () => {
      cancelled = true;
    };
  });

  // ---- the open record -------------------------------------------------------------------------

  /*
   * THE ADDRESS SAYS WHICH RECORD IS OPEN. A record has no screen of its own; it opens in the entity
   * window over this list, and `/directory?record=<id>` is its address (entity-presentation.ts).
   * So the names in the table stay real links, a row's activation is a navigation to that address,
   * and a link pasted into a message lands on the record with the book beneath it. The window
   * follows the address rather than the other way round: opening one is a navigation, so the
   * reader's history holds the list, then the record. A record opened from INSIDE the window (a
   * duplicate, a related organization) swaps the window's subject, and that swap is mirrored back
   * into the address in place, so the address never lies about what is on screen.
   */
  let recordOpen = $state(false);
  let recordId = $state("");

  $effect(() => {
    const addressed = entityRecordFromAddress(page.url);
    untrack(() => {
      if (addressed === null) {
        recordOpen = false;
        return;
      }
      if (recordId !== addressed) recordId = addressed;
      recordOpen = true;
    });
  });

  /** Put a record's identity into the address in place, or take it out. */
  function mirrorRecord(identifier: string | null): void {
    const url = new URL(page.url);
    if (identifier === null) url.searchParams.delete(RECORD_PARAMETER);
    else url.searchParams.set(RECORD_PARAMETER, identifier);
    if (url.href === page.url.href) return;
    replaceState(url, page.state);
  }

  // The window's subject changed from inside it; the address follows.
  $effect(() => {
    const identifier = recordId;
    untrack(() => {
      if (recordOpen && identifier !== "") mirrorRecord(identifier);
    });
  });

  // ---- adding a record -------------------------------------------------------------------------

  let dialogOpen = $state(false);
  let dialogKind = $state<DirectoryEntityKind>("person");

  function openNew(kindToAdd: DirectoryEntityKind): void {
    dialogKind = kindToAdd;
    dialogOpen = true;
  }

  /** A record was made: the index is read again so it is listed, and its window opens over it. */
  function created(entityId: string): void {
    rereadIndex();
    void goto(entityRecordHref(entityId));
  }
</script>

<svelte:head>
  <title>Directory · Magna Carta</title>
</svelte:head>

<!-- One table for the answer and for the shape it takes while it is asked, so the two cannot drift. -->
{#snippet hitTable(rows: readonly DirectorySearchHit[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">
      Directory records matching the search, in the firm's own relevance order
    </DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Name</DataTable.Head>
        <DataTable.Head>Kind</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as hit (hit.entityId)}
        <DataTable.Row ondblclick={() => void goto(entityRecordHref(hit.entityId))}>
          <DataTable.Cell>
            <EntityIdentity
              kind={hit.entityKind === "organization" ? "organization" : "person"}
              name={hit.displayName}
              href={entityRecordHref(hit.entityId)}
            />
          </DataTable.Cell>
          <DataTable.Cell>{searchHitKindLabel(hit.entityKind)}</DataTable.Cell>
        </DataTable.Row>
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

{#snippet directoryCell({ row, column, text }: DataTable.GridCellContext<DirectoryEntityListing>)}
  {#if column.id === "name"}
    <EntityIdentity
      kind={row.entityKind}
      name={listingName(row)}
      href={entityRecordHref(row.entityId)}
      aside={row.legalName}
    />
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Directory">
    {#snippet actions()}
      {#if searchOpen}
        <Input
          bind:ref={searchField}
          type="search"
          bind:value={typed}
          placeholder={placeholderOf("Search")}
          aria-label="Search"
          class="w-xs"
        />
      {/if}
      <Button
        variant="ghost"
        size="icon"
        aria-label={searching ? `Search: ${asked.trim()}` : "Search"}
        aria-expanded={searchOpen}
        title={searching ? `Searching "${asked.trim()}"` : "Search"}
        class={searching ? "text-accent-default" : undefined}
        onclick={toggleSearch}
      >
        <Search class="size-16" aria-hidden="true" />
      </Button>

      {#if !searching}
        <Popover.Root>
          <Popover.Trigger
            class={`${buttonClasses({ variant: "ghost", size: "icon" })} ${narrowed ? "text-accent-default" : ""}`}
            aria-label={narrowed ? `Filters: ${narrowingSummary}` : "Filters"}
            title={narrowed ? narrowingSummary : "Filters"}
          >
            <ListFilter class="size-16" aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Content class="flex flex-col gap-12">
            <RadioGroup.Root
              bind:value={kind}
              aria-label="Which records to list"
              class="flex flex-col gap-8"
            >
              {#each LISTING_KIND_ITEMS as item (item.value)}
                <div class="flex items-center gap-8">
                  <RadioGroup.Item value={item.value} id="directory-kind-{item.value}" />
                  <label class="text-sm" for="directory-kind-{item.value}">{item.label}</label>
                </div>
              {/each}
            </RadioGroup.Root>

            {#if grid.activeFilterCount > 0}
              <Separator />
              <ul class="flex flex-col gap-4">
                {#each grid.activeFilterLabels as label (label)}
                  <li class="text-xs text-text-muted">{label}</li>
                {/each}
              </ul>
            {/if}

            {#if narrowed}
              <Separator />
              <Button variant="secondary" onclick={showEveryone}>Show everyone</Button>
            {/if}
          </Popover.Content>
        </Popover.Root>

      {/if}
      <!-- The one create control (the design system's), LAST on the row: the search grows toward
           the inline start as it opens, so the control after it is the one place that growth cannot
           reach — the same order as the matter header and the custody register. -->
      <!-- One create control rather than a button per kind: the two records are the same gesture on
           the same book, and spreading them across the top spends the row on a choice a menu makes
           in one press. It reads the bare "New" and each ITEM carries the verb — a menu item is
           where the choice is actually made, so it names the whole thing being made. -->
      <CreateControl
        title="Record a person or an organization."
        refusal={mayEdit ? undefined : createDisabledReason}
        choices={[
          { label: "New Person", icon: UserPlus, onselect: () => openNew("person") },
          { label: "New Organization", icon: Building2, onselect: () => openNew("organization") },
        ]}
      />
    {/snippet}
  </ScreenHeader>

  {#if createDisabledReason !== undefined && session !== null}
    <Alert.Root variant="info">
      <Alert.Title>Adding To The Directory Is Not Available To This Account</Alert.Title>
      <Alert.Description>{createDisabledReason}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if tooShortToAsk}
    <p class="text-xs text-text-muted">
      It takes {MINIMUM_QUERY_LENGTH} letters to search. Every name the firm has ever recorded is matched,
      the ones a person no longer goes by included, and a misspelling still finds them.
    </p>
  {/if}

  {#if searching}
    <!-- The firm's own ranked answer. Not a table the reader can re-sort, because the rows are the
         best of a capped set and re-ordering them would read as the best of the firm's record. -->
    <LoadingRegion
      loading={hits === null}
      failed={searchFailure !== null}
      empty={hits !== null && hits.length === 0}
      label="Searching the directory"
      onRetry={searchAgain}
      class="flex min-h-0 flex-1 flex-col gap-8"
    >
      {#snippet failure()}
        {#if searchFailure !== null}
          <FailureNotice
            failure={searchFailure.failure}
            title="The Directory Could Not Be Searched"
            fallback={searchFailure.fallback}
            whenSilent={searchFailure.whenSilent}
            onRetry={searchAgain}
          />
        {/if}
      {/snippet}
      {#snippet fixture()}
        <div class="min-h-0 flex-1 overflow-auto">
          {@render hitTable(HIT_FIXTURE)}
        </div>
        <p class="text-xs text-text-muted">Every match the firm holds, in its own relevance order.</p>
      {/snippet}
      {#snippet emptyState()}
        <div class="min-h-0 flex-1">
          <EmptyState title="Nothing Matches That Search">
            No name on the firm's record answers to that, current or former. Recording them, with
            New at the top of the screen, is what puts them in front of the next conflicts check.
          </EmptyState>
        </div>
      {/snippet}
      <div class="min-h-0 flex-1 overflow-auto">
        {@render hitTable(hits ?? [])}
      </div>
      <p class="text-xs text-text-muted">
        {#if capped}
          The firm holds more matches than are shown. These are the closest; narrowing the
          search reaches the rest.
        {:else}
          Every match the firm holds, in its own relevance order.
        {/if}
      </p>
    </LoadingRegion>
  {:else if listFailure !== null}
    <!-- Through the standard failure surface. The Alert here interpolated the failure RECORD, so a
         reader got "[object Object]" where the sentence belonged, and no Error ID to report. -->
    <FailureNotice
      failure={listFailure}
      title="The Directory Could Not Be Read"
      fallback="The firm's directory could not be read."
      whenSilent="Nothing answered when the directory was asked for."
      onRetry={rereadIndex}
    />
  {:else}
    <!-- The table holds the height it would hold when full, so the screen does not reflow as the
         directory grows or a filter narrows it. -->
    <DataTable.Grid
      {grid}
      class="min-h-0 flex-1"
      caption="The firm's directory, in name order"
      cell={directoryCell}
      loading={records === null}
    >
      {#snippet empty()}
        {#if kind !== DEFAULT_LISTING_KIND}
          <EmptyState title="No {listingKindLabel(kind)} Yet">
            {#snippet actions()}
              <Button variant="secondary" onclick={showEveryone}>Show everyone</Button>
            {/snippet}
            The firm's directory holds nothing on this side of the book.
          </EmptyState>
        {:else}
          <EmptyState title="No Records Yet">
            Clients, opposing parties, counsel and courts all live here. Recording somebody, with
            New at the top of the screen, is what puts them in front of the next conflicts check.
          </EmptyState>
        {/if}
      {/snippet}
    </DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        {#if moreThanLoaded}
          <span>{total} in the firm's directory</span>
        {/if}
        <!-- The way to the rest of the list belongs beside the count that says there is more, not
             under the table where it read as an act on the page. -->
        <DataTable.LoadMore
          noun="records"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={loadMore}
        />
      {/snippet}
    </DataTable.GridFooter>


  {/if}
</div>

<!-- A person is recorded whole, every section reachable, on the side rail; an organization keeps
     the one-section form until its record grows the same sections. -->
{#if dialogKind === "person"}
  <NewPersonDialog bind:open={dialogOpen} onCreated={created} />
{:else}
  <NewOrganizationDialog bind:open={dialogOpen} onCreated={created} />
{/if}

<!-- The one surface a record opens in, over the book it belongs to. Closing it takes the record
     out of the address; a change to the record re-reads the index, so a renamed person is listed
     under the new name while the window is still up. -->
<EntityWindow
  bind:open={recordOpen}
  bind:entityId={recordId}
  onChanged={rereadIndex}
  onDismiss={() => mirrorRecord(null)}
/>

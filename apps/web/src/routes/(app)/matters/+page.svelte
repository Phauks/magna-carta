<script lang="ts">
  /*
   * Matters — the firm's docket, and the first screen of most working days.
   *
   * It reads the firm's own record and renders it on the platform's one table, so sorting, the
   * per-column filters, column show/hide, reorder, pinning, resize and the selection model are the
   * same machinery every other matter surface uses. Nothing here is a fixture.
   *
   * IT SHOWS EVERY MATTER, AND THE TABLE IS THE ONLY THING THAT NARROWS IT. There is no separate
   * control choosing between the working docket, open matters, closed matters and consultations:
   * those are values of the Status column, and the column filters this table already carries are
   * what a reader narrows by. Reading the whole record costs a second request (matters-api's
   * listEveryMatter says why), which is cheaper than a second narrowing mechanism a reader can
   * leave set without seeing it.
   *
   * THE BAND ABOVE THE TABLE BELONGS TO THE TABLE. Everything that is not the data is one row of
   * controls: the primary action, then search and the clear-filters control as icons. The
   * clear-filters control exists only while something is narrowing the view — its absence is the
   * signal that nothing is.
   *
   * EVERY FILTER OFFERS THE WHOLE VOCABULARY, NOT WHAT HAPPENS TO BE LOADED. Status, practice area,
   * Location and the responsible attorney each filter over something the FIRM declares, so each
   * hands the table that declaration and every value in it is offered whether or not a row on
   * screen carries it. A firm with nothing closed today can still hold closed matters, and a
   * control that dropped "Closed" for the day would be telling the reader otherwise. Client is the
   * one set filter with no declared vocabulary, because nothing publishes a client directory.
   *
   * TWO HONEST LIMITS. The listing is cursor-paged, so a filter MATCHES over what has been loaded
   * rather than over the firm — the choices are complete, the rows behind them are the page in
   * hand. And the responsible attorney, practice area and Location arrive as identifiers and are
   * named from the firm's own lists, read once per screen and joined here, never one request per
   * row: a row whose identifier nothing names renders empty rather than showing the handle.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Search from "@lucide/svelte/icons/search";
  import { goto } from "$app/navigation";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    listEveryMatter,
    listLocations,
    listMatterTypes,
    readSession,
    type LocationSummary,
    type MatterSummary,
    type MatterTypeSummary,
    type SessionBootstrap,
    CREATE_MATTER_PERMISSION,
  } from "$lib/matters/matters-api.ts";
  import {
    matterColumns,
    matterVocabulary,
    EMPTY_MATTER_VOCABULARY,
    MATTER_INITIAL_SORT,
  } from "$lib/matters/matter-columns.ts";
  import {
    docketIsNarrowed,
    docketNarrowingSummary,
  } from "$lib/matters/matter-docket-filters.ts";
  import { matterStatusPresentation } from "$lib/matters/matter-status.ts";
  import NewMatterDialog from "$lib/matters/new-matter-dialog.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";

  // ---- what the screen is asking for ----------------------------------------------------------

  let searchText = $state("");
  let appliedSearch = $state("");
  let searchOpen = $state(false);
  let searchField = $state<HTMLInputElement | null>(null);
  let dialogOpen = $state(false);
  let lastCreated = $state<{
    matterId: string;
    matterNumber: string | null;
    consultationNumber: string | null;
  } | null>(null);

  // The typed query settles before it is sent: a docket read per keystroke is a request per
  // keystroke, and the server's search is the authoritative one over title, number and client.
  $effect(() => {
    const typed = searchText;
    const timer = setTimeout(() => (appliedSearch = typed), 300);
    return () => clearTimeout(timer);
  });

  // The field opens where the icon was, so the gesture that revealed it also puts the caret in it.
  $effect(() => {
    if (searchOpen) searchField?.focus();
  });

  function toggleSearch(): void {
    if (searchOpen && searchText !== "") {
      // A live search is what the control is for, so the first press on an open field clears it
      // rather than hiding a narrowing the reader can then no longer see.
      searchText = "";
      return;
    }
    searchOpen = !searchOpen;
  }

  // ---- the firm's own vocabularies and who is asking -------------------------------------------

  let session = $state<SessionBootstrap | null>(null);
  let matterTypes = $state<readonly MatterTypeSummary[]>([]);
  let locations = $state<readonly LocationSummary[]>([]);
  let bootstrapped = $state(false);

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const [sessionOutcome, typesOutcome, locationsOutcome] = await Promise.all([
        readSession(fetch),
        listMatterTypes(fetch),
        listLocations(fetch),
        // The roster settles its own failure internally and is shared with the rest of the app, so
        // it rides the same bootstrap without a fourth outcome to unpack here.
        firmRoster.load(fetch),
      ]);
      if (sessionOutcome.kind === "ok") session = sessionOutcome.value;
      // A vocabulary that cannot be read leaves its column empty rather than failing the screen.
      if (typesOutcome.kind === "ok") matterTypes = typesOutcome.value.data;
      if (locationsOutcome.kind === "ok") locations = locationsOutcome.value.data;
    })();
  });

  // Every member the firm has, not only the active ones: a closed matter's responsible attorney may
  // have left, and their name is still the true answer for that row.
  const members = $derived(firmRoster.members ?? []);
  const vocabulary = $derived(
    matterTypes.length === 0 && locations.length === 0 && members.length === 0
      ? EMPTY_MATTER_VOCABULARY
      : matterVocabulary(matterTypes, locations, members),
  );

  const mayCreate = $derived(session?.permissions.includes(CREATE_MATTER_PERMISSION) ?? false);
  const createDisabledReason = $derived(
    session === null
      ? "Reading your session."
      : mayCreate
        ? undefined
        : "Opening a matter needs the matters:create permission, which this account does not hold.",
  );

  // ---- the docket ------------------------------------------------------------------------------

  const list = new PagedList<MatterSummary>("The firm's matters could not be read.");
  const matters = $derived(list.items);
  const loadFailure = $derived(list.failure);
  // A change of the settled query is a different question, so it is a different read.
  const subject = $derived(appliedSearch.trim());

  $effect(() => {
    const asked = subject;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load((cursor) => listEveryMatter(fetch, { search: appliedSearch, cursor }));
  });

  function loadMore(): void {
    void list.loadMore((cursor) => listEveryMatter(fetch, { search: appliedSearch, cursor }));
  }

  function reread(): void {
    list.reset(subject);
    void list.load((cursor) => listEveryMatter(fetch, { search: appliedSearch, cursor }));
  }

  const grid = DataTable.createDataTableGrid<MatterSummary>({
    columns: () => matterColumns(vocabulary),
    rows: () => matters ?? [],
    rowKey: (matter) => matter.id,
    initialSort: MATTER_INITIAL_SORT,
    itemNoun: { singular: "matter", plural: "matters" },
    // Double-click and Enter open the matter, anywhere on the row. The title stays a real link
    // beside it so the browser's own gestures (middle-click, open in new tab) still work, but
    // nobody has to hit it.
    onActivate: (matter) => void goto(`/matters/${matter.id}`),
  });

  const narrowing = $derived({
    search: appliedSearch,
    columnFilterCount: grid.activeFilterCount,
  });
  const narrowed = $derived(docketIsNarrowed(narrowing));
  const narrowingSummary = $derived(docketNarrowingSummary(narrowing));
  const searching = $derived(appliedSearch.trim() !== "");

  function clearNarrowing(): void {
    searchText = "";
    grid.clearAllFilters();
  }

  function onCreated(created: {
    matterId: string;
    matterNumber: string | null;
    consultationNumber: string | null;
  }): void {
    lastCreated = created;
    reread();
  }

  /**
   * A practice area the intake added to the firm, held here too.
   *
   * The screen read the firm's matter types once, and the intake can add one — so without this the
   * new area would name the new matter's Practice Area cell nothing until the next page load, and
   * the column's filter would not offer it. Held rather than re-read: the answer is already in
   * hand, and a second list read to learn what this screen just did would be a request for a fact
   * it already has.
   */
  function onMatterTypeAdopted(created: MatterTypeSummary): void {
    if (matterTypes.some((type) => type.id === created.id)) return;
    matterTypes = [...matterTypes, created];
  }
</script>

<svelte:head>
  <title>Matters · Magna Carta</title>
</svelte:head>

{#snippet matterCell({ row, column, text }: DataTable.GridCellContext<MatterSummary>)}
  {#if column.id === "matterNumber" && text !== ""}
    <!-- Tabular figures: matter numbers are read down a column and have to align. -->
    <span class="tabular-nums">{text}</span>
  {:else if column.id === "title"}
    <a class="underline underline-offset-2" href="/matters/{row.id}">{row.title}</a>
  {:else if column.id === "status"}
    {@const seal = matterStatusPresentation(row.status)}
    <Badge variant={seal.variant}>{seal.label}</Badge>
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full flex-col gap-16">
  <Masthead.Root>
    <Masthead.Heading>
      <Masthead.Title>Matters</Masthead.Title>
    </Masthead.Heading>
    <Masthead.Actions>
      <Button
        variant="primary"
        disabled={!mayCreate}
        title={createDisabledReason}
        onclick={() => (dialogOpen = true)}
      >
        <Plus class="size-16" aria-hidden="true" />
        New matter
      </Button>

      {#if searchOpen}
        <Input
          bind:ref={searchField}
          type="search"
          bind:value={searchText}
          placeholder="Search"
          aria-label="Search"
          class="w-xs"
        />
      {/if}
      <Button
        variant="ghost"
        size="icon"
        aria-label={searching ? `Search: ${appliedSearch.trim()}` : "Search"}
        aria-expanded={searchOpen}
        title={searching ? `Searching "${appliedSearch.trim()}"` : "Search"}
        class={searching ? "text-accent-default" : undefined}
        onclick={toggleSearch}
      >
        <Search class="size-16" aria-hidden="true" />
      </Button>

      {#if narrowed}
        <!-- The control exists only while something is narrowing the view: its absence says
             nothing is, which is a thing a reader can see without reading anything. -->
        <Button
          variant="ghost"
          size="icon"
          aria-label="Show every matter: {narrowingSummary}"
          title={narrowingSummary}
          class="text-accent-default"
          onclick={clearNarrowing}
        >
          <FunnelX class="size-16" aria-hidden="true" />
        </Button>
      {/if}
    </Masthead.Actions>
  </Masthead.Root>

  {#if lastCreated !== null}
    <!-- The heading follows the outcome, never the intent: a consultation was not opened. -->
    <Alert.Root variant="success">
      <Alert.Title>
        {lastCreated.matterNumber === null ? "The Consultation Is Recorded" : "The Matter Is Open"}
      </Alert.Title>
      <Alert.Description>
        <!-- The link says the number the thing was given, whichever sequence gave it: a
             consultation now leaves this window with a number of its own to quote. -->
        <a class="underline underline-offset-2" href="/matters/{lastCreated.matterId}">
          {lastCreated.matterNumber ?? lastCreated.consultationNumber ?? "Open the consultation"}
        </a>
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if firmRoster.failure !== null}
    <Alert.Root variant="info">
      <Alert.Title>The Firm's Member List Could Not Be Read</Alert.Title>
      <Alert.Description>{firmRoster.failure}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if loadFailure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>The Docket Could Not Be Read</Alert.Title>
      <Alert.Description>
        {loadFailure}
        <Button variant="secondary" class="mt-8" onclick={reread}>
          <RotateCcw class="size-16" aria-hidden="true" />
          Try again
        </Button>
      </Alert.Description>
    </Alert.Root>
  {:else}
    <!-- The table holds the height it would hold when full, so the screen does not reflow as the
         docket grows or a filter narrows it. -->
    <DataTable.Grid
      {grid}
      class="min-h-0 flex-1"
      caption="The firm's matters"
      cell={matterCell}
      loading={matters === null}
    >
      {#snippet empty()}
        {#if searching}
          <EmptyState title="Nothing Matches That Search">
            No matter answers to that title, number or client.
          </EmptyState>
        {:else}
          <EmptyState title="No Matters Yet">
            {#snippet actions()}
              <Button
                variant="primary"
                disabled={!mayCreate}
                title={createDisabledReason}
                onclick={() => (dialogOpen = true)}
              >
                <Plus class="size-16" aria-hidden="true" />
                New matter
              </Button>
            {/snippet}
            Numbering, documents, time and trust all hang from a matter.
          </EmptyState>
        {/if}
      {/snippet}
    </DataTable.Grid>

    <!-- The counts strip: how much of the record is on screen, what is hiding the rest, and the
         one-click way back to all of it. One line at a fixed height, so it never reflows. -->
    <DataTable.GridFooter {grid}>
      {#snippet end()}
        {#if list.nextCursor !== null}
          <Button variant="secondary" size="sm" onclick={loadMore} disabled={list.loadingMore}>
            {list.loadingMore ? "Loading" : "Load more matters"}
          </Button>
        {/if}
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>

{#if session !== null}
  <NewMatterDialog
    bind:open={dialogOpen}
    {session}
    {matterTypes}
    {locations}
    matters={matters ?? []}
    {onCreated}
    {onMatterTypeAdopted}
  />
{/if}

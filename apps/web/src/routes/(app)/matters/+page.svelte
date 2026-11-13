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
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import Badge from "@magna-carta/design-system/badge";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { goto } from "$app/navigation";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    locationsListOptions,
    matterTypesListOptions,
    matterTypesListQueryKey,
    meGetOptions,
    membersListOptions,
    type MatterType,
  } from "@magna-carta/api-client";
  import { failureOf } from "$lib/api/api-client.ts";
  import { queryClient, SESSION_STABLE } from "$lib/api/screen-data.ts";
  import {
    listEveryMatter,
    type MatterSummary,
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
  import { permissionRefusal } from "$lib/access/refusal.ts";

  // ---- what the screen is asking for ----------------------------------------------------------

  let searchText = $state("");
  let appliedSearch = $state("");
  let dialogOpen = $state(false);
  let lastCreated = $state<{
    matterId: string;
    matterNumber: string | null;
    consultationNumber: string | null;
  } | null>(null);

  // ---- the firm's own vocabularies and who is asking -------------------------------------------

  /*
   * The firm's own vocabularies, and who is asking.
   *
   * FOUR READS, NO EFFECT, AND USUALLY NO REQUESTS. Each is warmed from this route's `+page.ts`, so
   * they start while the pointer is still on the link that leads here and resolve out of the cache
   * by the time this component mounts. The `$effect` that used to fan them out could not start until
   * the chunk had been fetched and mounted, which put a whole round trip after the click.
   *
   * They are session-stable: the firm's practice areas, its Locations and its roster change when an
   * administrator changes them, so a second screen asking the same question inside ten minutes is
   * answered from the cache rather than from the server. A vocabulary that cannot be read leaves its
   * column empty rather than failing the screen — `data` is simply undefined and the fallbacks below
   * carry it, which is the same posture the four separate outcome unpacks used to take one at a time.
   */
  const sessionRead = createQuery(() => ({ ...meGetOptions(), staleTime: SESSION_STABLE }));
  const matterTypesRead = createQuery(() => ({
    ...matterTypesListOptions(),
    staleTime: SESSION_STABLE,
  }));
  const locationsRead = createQuery(() => ({ ...locationsListOptions(), staleTime: SESSION_STABLE }));
  const rosterRead = createQuery(() => ({ ...membersListOptions(), staleTime: SESSION_STABLE }));

  const session = $derived(sessionRead.data ?? null);
  const matterTypes = $derived(matterTypesRead.data?.data ?? []);
  const locations = $derived(locationsRead.data?.data ?? []);
  // Every member the firm has, not only the active ones: a closed matter's responsible attorney may
  // have left, and their name is still the true answer for that row.
  const members = $derived(rosterRead.data?.data ?? []);
  /*
   * The roster is not this screen's subject, so its failure never fails the screen: the responsible
   * attorney column renders empty and a line beside the table says why. A member refused the read
   * (403) is told the same thing as a member whose request did not arrive, because the remedy — ask
   * an administrator — is the same, and naming the permission at somebody who cannot grant it
   * themselves is noise.
   */
  const rosterFailure = $derived.by(() => {
    if (rosterRead.error === null) return null;
    return failureOf(rosterRead.error).problem?.status === 403
      ? "Your account cannot read the firm's member list."
      : "The firm's member list could not be read.";
  });
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
        : permissionRefusal("Opening a matter", "matters:create"),
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

  // Both halves of the query, because the control reports a query it was TYPED into and clearing
  // from out here is not typing: leaving `appliedSearch` set would clear the field and leave the
  // docket narrowed by a query no longer on screen.
  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
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
   * the column's filter would not offer it. Written into the CACHE rather than into this screen's
   * own state, which is the difference the shared cache makes: every other surface reading the
   * firm's practice areas — the new-matter dialog, the intake desk, settings — sees the new one
   * too, where a screen-local copy would have left them all stale until their next read. Still not
   * a re-read: a list request to learn what this screen just did would be asking for a fact already
   * in hand.
   */
  function onMatterTypeAdopted(created: MatterType): void {
    if (matterTypes.some((type) => type.id === created.id)) return;
    queryClient.setQueryData(matterTypesListQueryKey(), (held: { data: MatterType[] } | undefined) =>
      held === undefined ? { data: [created] } : { data: [...held.data, created] },
    );
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
  <ScreenHeader title="Matters">
    {#snippet actions()}
      <!-- The search, then the narrowing controls, then the create control: the search grows toward
           the inline start, so the controls at the row's end never move when it opens. The same
           pair, in the same order, as every other list screen. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the docket"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />

      <DataTable.ClearFilters
        {grid}
        narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }}
      />

      <!-- The one create control (the design system's), LAST on the row: the search grows toward
           the inline start as it opens, so the control after it is the one place that growth cannot
           reach — the same order as the matter header and the custody register. -->
      <CreateControl
        noun="Matter"
        title="Open a new matter or take a consultation."
        refusal={mayCreate ? undefined : createDisabledReason}
        onpress={() => (dialogOpen = true)}
      />
    {/snippet}
  </ScreenHeader>

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

  {#if rosterFailure !== null}
    <Alert.Root variant="info">
      <Alert.Title>The Firm's Member List Could Not Be Read</Alert.Title>
      <Alert.Description>{rosterFailure}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if loadFailure !== null}
    <!-- Through the standard failure surface rather than an Alert of this screen's own. The
         hand-rolled one interpolated the failure RECORD, so a reader got "[object Object]" where the
         sentence should have been — and no Error ID, which is the one thing that makes a report
         actionable. FailureNotice reads the problem's own detail, falls back to this screen's words
         when the server sent none, and carries the correlation handle and the retry. -->
    <FailureNotice
      failure={loadFailure}
      title="The Docket Could Not Be Read"
      fallback="The firm's matters could not be read."
      whenSilent="Couldn't connect while loading the docket."
      onRetry={reread}
    />
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
    </DataTable.Grid>

    <!-- The counts strip: how much of the record is on screen, what is hiding the rest, and the
         one-click way back to all of it. One line at a fixed height, so it never reflows. -->
    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="matters"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={loadMore}
        />
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

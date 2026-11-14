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
   * THE INDEX AND THE SEARCH ANSWER ARE STILL DIFFERENT OBJECTS, AND THEY ARE NO LONGER DIFFERENT
   * SURFACES. The distinction is real and is kept: an index is sorted, walkable and counted, where a
   * ranked answer returns its best matches, in the firm's own relevance order, and stops. What was
   * wrong was WHERE that difference was shown. Typing used to swap the reader's table — eleven
   * columns, their own sorting, their own narrowing — out for a two-column list of hits, so the act
   * of searching cost them the surface they were reading. Now the query narrows the table in place,
   * exactly as the matters docket narrows its docket, and the difference between the two questions
   * is carried where it belongs: in the footer's own sentence, which says when the answer was cut
   * short, and in the order, which is the server's until the reader sorts it themselves.
   *
   * WHILE A QUERY IS LIVE THE ANSWER ALSO HOLDS MATTERS. Somebody searching the firm's directory for
   * "Pemberton" is as often looking for the file as for the person, and sending them to a second
   * screen to find out is the same defect in another form. A matter is not dressed as a directory
   * record: its Kind says Matter, every contact column on it is blank, and opening it opens the
   * matter. The RESTING index stays the book of people and organizations, and its count stays the
   * directory's own — a screen that quietly counted matters into "in the firm's directory" would be
   * lying about the one number on it.
   *
   * Both directory kinds sit in ONE listing. A person and an organization are two entries in the
   * same book, and a reader looking for "Pemberton" does not know in advance which the firm filed.
   * Kind is a column and a filter, never a second screen.
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
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Building2 from "@lucide/svelte/icons/building-2";
  import CreateControl from "@magna-carta/design-system/create-control";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import { goto, replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { untrack } from "svelte";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import {
    listEveryMatter,
    readSession,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import {
    listDirectoryEntities,
    DIRECTORY_EDIT_PERMISSION,
    type DirectoryEntityKind,
    type DirectoryEntityListing,
  } from "$lib/directory/directory-api.ts";
  import { isAskableQuery, MINIMUM_QUERY_LENGTH } from "$lib/directory/directory-search.ts";
  import {
    directoryListingColumns,
    isMatterListing,
    listingName,
    listingRowKey,
    matterListingRow,
    DIRECTORY_LISTING_INITIAL_SORT,
    DIRECTORY_SEARCH_INITIAL_SORT,
    type DirectoryListingRow,
    type MatterListing,
  } from "$lib/directory/directory-listing.ts";
  import {
    entityRecordFromAddress,
    entityRecordHref,
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

  const query = $derived(asked.trim());
  const searching = $derived(isAskableQuery(query));
  // Typed, but not yet enough to ask. The index stays on screen and one line says what is missing,
  // rather than the screen silently doing nothing while somebody types.
  const tooShortToAsk = $derived(!searching && typed.trim() !== "");

  // ---- the listing, asked one way or the other -------------------------------------------------

  const list = new PagedList<DirectoryEntityListing>("The firm's directory could not be read.");
  const records = $derived(list.items);
  const listFailure = $derived(list.failure);
  let total = $state(0);
  let capped = $state(false);
  let reloadToken = $state(0);

  // The whole book is read, both kinds in one sequence; narrowing to one of them is the Kind
  // column's set filter, over the rows in hand, and never a second question to the server. The
  // QUERY is the one thing the server is asked, because a ranked answer over the firm's whole
  // record is not something a browser holding fifty rows can work out for itself.
  const listSubject = $derived(`${String(reloadToken)}:${searching ? query : ""}`);

  function readPage(asking: string | null, cursor?: string) {
    return listDirectoryEntities(fetch, { cursor, search: asking ?? undefined });
  }

  // The count travels on every page, so it is taken from whichever page last landed rather than
  // cached from the first: a record created while somebody is on page three is counted.
  async function readFirstPage(asking: string | null): Promise<void> {
    await list.load(async (cursor) => {
      const outcome = await readPage(asking, cursor);
      if (outcome.kind === "ok") {
        total = outcome.value.total;
        capped = outcome.value.capped;
      }
      return outcome;
    });
  }

  $effect(() => {
    const subject = listSubject;
    const asking = searching ? query : null;
    if (list.showing(subject)) return;
    list.reset(subject);
    // The count belongs to the question that was asked, so a re-read starts from no count rather
    // than printing the previous answer's total beside the new one's first page.
    total = 0;
    capped = false;
    void readFirstPage(asking);
  });

  function loadMore(): void {
    const asking = searching ? query : null;
    void list.loadMore(async (cursor) => {
      const outcome = await readPage(asking, cursor);
      if (outcome.kind === "ok") {
        total = outcome.value.total;
        capped = outcome.value.capped;
      }
      return outcome;
    });
  }

  function rereadIndex(): void {
    reloadToken += 1;
  }

  // ---- the firm's matters, while a query is live -----------------------------------------------

  /*
   * A SECOND READ THAT FAILS ON ITS OWN. The matters are a different register behind a different
   * endpoint, so a firm whose docket is unreadable must still get its directory answer — the
   * alternative is one subsystem's outage blanking another's. The failure is stated in a line of
   * its own and the rows below it are still the truth.
   *
   * The two answers are not interleaved. Each is ranked by its own server against its own corpus,
   * and the two scores mean nothing against each other, so the directory's answer leads and the
   * matters follow it. A reader who wants them in one order sorts by a column, which is a question
   * the table can answer honestly.
   */
  let matters = $state<readonly MatterListing[] | null>(null);
  let matterFailure = $state<StatedFailure | null>(null);
  let searchToken = $state(0);

  $effect(() => {
    const asking = searching ? query : "";
    void searchToken;
    if (asking === "") {
      matters = null;
      matterFailure = null;
      return;
    }
    let cancelled = false;
    matters = null;
    matterFailure = null;
    void (async () => {
      const outcome = await listEveryMatter(fetch, { search: asking });
      if (cancelled) return;
      if (outcome.kind === "ok") {
        matters = outcome.value.data.map(matterListingRow);
        return;
      }
      matters = [];
      matterFailure = stated(outcome.failure, "The firm's matters could not be searched.");
    })();
    return () => {
      cancelled = true;
    };
  });

  function searchAgain(): void {
    searchToken += 1;
  }

  // ---- the one table ---------------------------------------------------------------------------

  const rows = $derived<readonly DirectoryListingRow[]>([
    ...(records ?? []),
    ...(searching ? (matters ?? []) : []),
  ]);
  const holdsMatters = $derived(searching && (matters?.length ?? 0) > 0);

  const grid = DataTable.createDataTableGrid<DirectoryListingRow>({
    columns: () => directoryListingColumns({ withMatters: holdsMatters }),
    rows: () => rows,
    rowKey: listingRowKey,
    initialSort: DIRECTORY_LISTING_INITIAL_SORT,
    itemNoun: { singular: "record", plural: "records" },
    // Double-click and Enter open the record. The name stays a real link beside it, so the
    // browser's own gestures still work; nobody has to hit the link precisely.
    onActivate: (row) =>
      void goto(isMatterListing(row) ? `/matters/${row.matterId}` : entityRecordHref(row.entityId)),
  });

  /*
   * THE ORDER FOLLOWS THE QUESTION. The index is a book of names and opens in name order; a ranked
   * answer arrives in the firm's own relevance order and opens as it arrived, because sorting a
   * capped best-of by a column puts the best of an arbitrary slice at the top and reads as the best
   * of the firm's record. Either way the reader may sort by clicking a header — that is them asking
   * something else, and the table answers it over the rows it holds.
   */
  let sortedAs = $state<"index" | "search">("index");
  $effect(() => {
    const wanted = searching ? "search" : "index";
    untrack(() => {
      if (sortedAs === wanted) return;
      sortedAs = wanted;
      const sort =
        wanted === "search" ? DIRECTORY_SEARCH_INITIAL_SORT : DIRECTORY_LISTING_INITIAL_SORT;
      grid.setSort(sort.columnId, sort.direction);
    });
  });

  // The count only needs stating while the page on screen is not the whole record.
  const moreThanLoaded = $derived(total > (records?.length ?? 0));
  // Both reads have landed and neither found anything. Asked before the matters answer settles, a
  // directory with no match would flash the empty state over an answer that was still coming.
  const answeredNothing = $derived(
    searching && records !== null && matters !== null && rows.length === 0,
  );

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

{#snippet directoryCell({ row, column, text }: DataTable.GridCellContext<DirectoryListingRow>)}
  {#if column.id === "name" && isMatterListing(row)}
    <!-- A matter is named as a matter: the title, with the number the file is quoted under
         beneath it. Not an EntityIdentity — that mark says which side of the DIRECTORY a record
         is, and a matter is on neither side of it. -->
    <span class="flex flex-col">
      <a class="underline-offset-2 hover:underline" href="/matters/{row.matterId}">{listingName(row)}</a>
      {#if row.matterNumber !== ""}
        <span class="text-xs text-text-muted">{row.matterNumber}</span>
      {/if}
    </span>
  {:else if column.id === "name" && !isMatterListing(row)}
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
      <!-- The search, then the narrowing control, then the create control: the search grows toward
           the inline start, so the controls at the row's end never move when it opens. The same
           pair, in the same order, as every other list screen. -->
      <ScreenSearch
        bind:value={typed}
        label="Search the directory"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          asked = next;
        }}
      />

      <!-- The way back to the whole book, and the only control on this row that is about narrowing.
           It renders only while something is actually holding rows back, so an unfiltered screen
           carries no control for a state it is not in. Every narrowing itself is set in a column's
           own header menu — including which kind of record is listed. -->
      <DataTable.ClearFilters {grid} />
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

  <!-- The firm's matters answer beside the directory's own records, and the two reads fail apart:
       a docket that cannot be read costs the reader the matter rows and nothing else. -->
  {#if matterFailure !== null}
    <FailureNotice
      failure={matterFailure.failure}
      title="The Firm's Matters Could Not Be Searched"
      fallback={matterFailure.fallback}
      whenSilent={matterFailure.whenSilent}
      onRetry={searchAgain}
    />
  {/if}

  {#if listFailure !== null}
    <!-- Through the standard failure surface. The Alert here interpolated the failure RECORD, so a
         reader got "[object Object]" where the sentence belonged, and no Error ID to report. -->
    <FailureNotice
      failure={listFailure}
      title="The Directory Could Not Be Read"
      fallback="The firm's directory could not be read."
      whenSilent="Nothing answered when the directory was asked for."
      onRetry={rereadIndex}
    />
  {:else if answeredNothing}
    <!-- A question the record cannot answer is not an empty table; it is an answer, and it says
         what to do next. -->
    <div class="min-h-0 flex-1">
      <EmptyState title="Nothing Matches That Search">
        No name on the firm's record answers to that, current or former. Recording them, with New at
        the top of the screen, is what puts them in front of the next conflicts check.
      </EmptyState>
    </div>
  {:else}
    <!-- The table holds the height it would hold when full, so the screen does not reflow as the
         directory grows or a filter narrows it. -->
    <DataTable.Grid
      {grid}
      class="min-h-0 flex-1"
      caption={searching
        ? "The firm's records and matters matching the search, in its own relevance order"
        : "The firm's directory, in name order"}
      cell={directoryCell}
      loading={records === null}
    ></DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        {#if searching}
          <!-- What a ranked answer owes the reader: whether this is all of it. The index's own
               count has no place here — the rows are a best-of, not a slice of a known total. -->
          {#if capped}
            <span>
              The firm holds more matches than are shown. These are the closest; narrowing the
              search reaches the rest.
            </span>
          {/if}
        {:else if moreThanLoaded}
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

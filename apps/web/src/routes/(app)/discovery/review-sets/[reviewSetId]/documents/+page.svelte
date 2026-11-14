<script lang="ts">
  /*
   * The corpus itself — one table at the full width, narrowed from one control.
   *
   * WHY THERE IS NO FACETED RAIL. Every e-discovery tool in the world puts one down the left side,
   * and the Custodian register tried the same thing and lost it on 2026-09-06: a rail made that
   * register read as a different kind of table from every other one in the product, and it did not
   * earn the difference. Everything this corpus is narrowed by — the Custodian of Record, the load,
   * the family, how far a document got, why it got no further — is a property of a row, and one
   * control sets them (narrow-control.svelte, over the registry in criteria.ts).
   *
   * THE NARROWING RIDES THE ADDRESS, which is not decoration: a criteria set in the query string
   * makes a narrowed corpus a link a supervising attorney can hand to a reviewer, and it is the
   * same object a bulk coding act will freeze and a production will resolve. That is why the
   * criteria set is criteria and never a list of document identifiers.
   *
   * A CHANGE OF CRITERIA IS A DIFFERENT QUESTION AND A FRESH READ. The listing is cursor-paged, so
   * filtering what has been loaded would answer confidently about a fraction of the corpus. The
   * grid's own per-column filters do run over the rows in hand, and the footer strip says what its
   * counts are counting.
   *
   * THE SEARCH IS A CRITERION, NOT A FILTER OVER THE PAGE. ScreenSearch is the product's one control
   * for searching within the screen you are on, and every list screen carries it — but on a corpus
   * this size, a control that narrowed the rows already fetched would tell a reviewer they had
   * searched a review set when they had searched a page of it, which on this screen of all screens
   * is the mistake that costs the most. So the field sets the `search` criterion in criteria.ts like
   * any other narrowing: it goes into the address, it composes into the server read, it reaches
   * every document in the corpus, and a bulk coding act over the result works because what it holds
   * is a criteria set rather than a page of identifiers.
   *
   * IT SEARCHES WHAT A DOCUMENT IS CALLED, NOT WHAT IS IN IT. Keyword is a separate criterion,
   * declared and `soon`, and it composes into the review set's own index rather than into this list.
   * The two are next to each other in the Narrow control so the difference is legible where a reader
   * is choosing between them, and the search field's own panel says which one it is.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { page } from "$app/state";
  import { goto, replaceState } from "$app/navigation";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import NarrowControl from "$lib/discovery/narrow-control.svelte";
  import {
    listLoads,
    listRecordCustodians,
    listReviewDocuments,
    type DiscoveryLoad,
    type RecordCustodian,
    type ReviewDocument,
    type ReviewSet,
  } from "$lib/discovery/discovery-api.ts";
  import {
    composeDocumentQuery,
    criteriaAreSet,
    criteriaFromSearchParameters,
    criteriaToSearchParameters,
    withCriterion,
    type CriteriaSet,
  } from "$lib/discovery/criteria.ts";
  import {
    EMPTY_DOCUMENT_VOCABULARY,
    reviewDocumentColumns,
    REVIEW_DOCUMENT_INITIAL_SORT,
    type DocumentVocabulary,
  } from "$lib/discovery/document-columns.ts";
  import {
    indexStateEntry,
    loadLaneEntry,
    processingStateEntry,
  } from "$lib/discovery/discovery-vocabulary.ts";

  let { data }: { data: { reviewSet: ReviewSet } } = $props();

  const reviewSet = $derived(data.reviewSet);

  let custodians = $state<readonly RecordCustodian[]>([]);
  let loads = $state<readonly DiscoveryLoad[]>([]);
  let vocabularyReviewSetId = $state<string | null>(null);

  /*
   * The review set's own vocabulary: who its Custodians of Record are and what its loads are
   * called. Read once per review set and joined into both the columns and the narrowing control, so
   * a name is resolved once rather than per row and the two can never disagree about what a handle
   * is called.
   */
  $effect(() => {
    const id = reviewSet.id;
    if (vocabularyReviewSetId === id) return;
    vocabularyReviewSetId = id;
    void (async () => {
      const [roster, deliveries] = await Promise.all([
        listRecordCustodians(fetch, id),
        listLoads(fetch, id),
      ]);
      custodians = roster.kind === "ok" ? roster.value.data : [];
      loads = deliveries.kind === "ok" ? deliveries.value.data : [];
    })();
  });

  const vocabulary = $derived<DocumentVocabulary>(
    custodians.length === 0 && loads.length === 0
      ? EMPTY_DOCUMENT_VOCABULARY
      : {
          custodianNames: new Map(custodians.map((one) => [one.id, one.displayName])),
          loadNames: new Map(
            loads.map((load) => [load.id, load.sourceDescription ?? loadLaneEntry(load.lane).label]),
          ),
        },
  );

  const criteria = $derived(criteriaFromSearchParameters(page.url.searchParams));

  /*
   * The criteria set is held in the address and nowhere else, so there is one answer to "what is
   * this list narrowed by" — the one a reader can copy out of the location bar. `replaceState`
   * rather than a push: narrowing is not a place somebody navigated to, and filling the back stack
   * with every adjustment would make the way out of a narrowed list a dozen presses long.
   */
  function narrow(next: CriteriaSet): void {
    const parameters = criteriaToSearchParameters(next);
    const search = parameters.toString();
    replaceState(`${page.url.pathname}${search === "" ? "" : `?${search}`}`, page.state);
  }

  const list = new PagedList<ReviewDocument>("The documents could not be read.");
  const documents = $derived(list.items);

  const query = $derived(composeDocumentQuery(criteria));
  const subject = $derived(
    [
      reviewSet.id,
      query.recordCustodianId ?? "",
      query.discoveryLoadId ?? "",
      query.familyId ?? "",
      query.processingState ?? "",
      query.exceptionCode ?? "",
      query.search ?? "",
    ].join("|"),
  );

  function read(cursor?: string) {
    return listReviewDocuments(fetch, reviewSet.id, { ...query, cursor });
  }

  $effect(() => {
    const asked = subject;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load(read);
  });

  const narrowed = $derived(criteriaAreSet(criteria));

  /*
   * The field's own text, written back to the address once typing settles.
   *
   * The address is still the one home of what this list is narrowed by — the field is a control over
   * that criterion, not a second copy of it — but the field cannot be derived FROM the address:
   * `searchOn="pause"` writes the criterion only when typing stops, and a derived value would empty
   * the field between every keystroke and the write that follows it. It holds its own text for the
   * length of one pause, which is what keeps the caret where the person put it, and adopts the
   * address's term whenever something else changes it (the effect below).
   */
  let searchText = $state("");
  let searchOpen = $state(false);

  /*
   * The term the address is currently on, and the reason this is not a `$derived`.
   *
   * The criterion can change from three places — this field, the Narrow control's Clear beside it,
   * and Show Everything — and the field has to follow the other two without fighting itself between
   * a keystroke and the pause that writes it. Holding what was last applied is what tells those
   * apart: a change this field made is already in the field, and any other change is one to adopt.
   */
  let appliedSearch = $state("");

  /*
   * Adopting a term the field did not write, which on the first run is the one the address arrived
   * carrying — so a searched queue somebody was sent lands with the field open on the query that
   * made it, rather than looking like an unexplained short list.
   */
  $effect(() => {
    const onAddress = criteria.search ?? "";
    if (onAddress === appliedSearch) return;
    appliedSearch = onAddress;
    searchText = onAddress;
    if (onAddress !== "") searchOpen = true;
  });

  function applySearch(next: string): void {
    const term = next.trim();
    appliedSearch = term;
    narrow(withCriterion(criteria, "search", term));
  }

  const columns = $derived(reviewDocumentColumns(vocabulary));

  const grid = DataTable.createDataTableGrid<ReviewDocument>({
    columns: () => columns,
    rows: () => documents ?? [],
    rowKey: (document) => document.id,
    initialSort: REVIEW_DOCUMENT_INITIAL_SORT,
    itemNoun: { singular: "document", plural: "documents" },
    /*
     * Opening a row opens the REVIEWER on that document, carrying whatever this list is narrowed to.
     * That is what makes the two presentations one screen: the queue the reviewer walks is this
     * list, in this order, and going back returns to it still narrowed.
     */
    onActivate: (document) => void goto(documentHref(document.id)),
  });

  /** One document's address in the reviewer, carrying the narrowing this list is on. */
  function documentHref(id: string): string {
    const search = criteriaToSearchParameters(criteria).toString();
    const base = `/discovery/review-sets/${reviewSet.id}/documents/${id}`;
    return search === "" ? base : `${base}?${search}`;
  }
</script>

{#snippet documentCell({ row, column, text }: DataTable.GridCellContext<ReviewDocument>)}
  {#if column.id === "processingState"}
    <Badge
      variant={processingStateEntry(row.processingState).tone}
      title={processingStateEntry(row.processingState).meaning}
    >
      {processingStateEntry(row.processingState).label}
    </Badge>
  {:else if column.id === "indexState"}
    <Badge
      variant={indexStateEntry(row.indexState).tone}
      title={indexStateEntry(row.indexState).meaning}
    >
      {indexStateEntry(row.indexState).label}
    </Badge>
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-16">
  <!-- One compact action row: everything above the data that is not the data. The search takes the
       inline end (it grows toward the inline start, so nothing after it moves when it opens) and
       the way back to the whole list sits at the row's end, where the narrowing was set. -->
  <div class="flex items-center gap-8">
    <NarrowControl {criteria} context={{ recordCustodians: custodians, loads }} onChange={narrow} />

    <ScreenSearch
      bind:value={searchText}
      bind:expanded={searchOpen}
      label="Search these documents"
      searchOn="pause"
      fieldClass="w-2xs sm:w-xs"
      class="ms-auto"
      onsearch={applySearch}
    >
      {#snippet panel()}
        <p class="text-text-muted w-2xs p-8 text-sm sm:w-xs">
          Search documents in this review set by name or path. To search the words inside them, use Keyword under Narrow.
        </p>
      {/snippet}
    </ScreenSearch>

    <DataTable.ClearFilters
      {grid}
      narrowing={{
        narrowed,
        summary: narrowed ? "Showing part of this review set" : "Show every document",
        clear: () => {
          applySearch("");
          searchText = "";
          narrow({});
          grid.clearAllFilters();
        },
      }}
    />
  </div>

  {#if list.failure !== null}
    <FailureNotice
      failure={list.failure}
      title="The Documents Could Not Be Read"
      fallback={list.failureMessage ?? undefined}
      onRetry={() => {
        list.reset(subject);
        void list.load(read);
      }}
    />
  {:else}
    <DataTable.Grid
      {grid}
      class="min-h-0 flex-1"
      caption="The documents in this review set"
      cell={documentCell}
      loading={documents === null}
    >
    </DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="documents"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={() => void list.loadMore(read)}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>

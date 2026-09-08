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
   * THE SEARCH IS THAT SAME SCOPE, AND SAYS SO. ScreenSearch is the product's one control for
   * searching within the screen you are on, and every list screen carries it; this one reaches the
   * rows already read, by what those rows SHOW — a document's name, its path, its format, whose
   * records it is, which delivery it came on. That is not keyword search of a document's text, and
   * on this screen of all screens the difference is worth a sentence rather than a guess: a
   * reviewer who thinks they have searched a corpus and has searched a page of it is the mistake
   * this surface can least afford. Keyword is declared in criteria.ts, waiting on the search
   * engine, and it will compose into the index rather than into this list — so it arrives in the
   * Narrow control beside this one, and the panel below says where it lives until then.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import EmptyState from "@magna-carta/design-system/empty-state";
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

  /** What the search field holds. It narrows the rows already read, never the server's answer. */
  let searchText = $state("");
  const searching = $derived(searchText.trim() !== "");

  const columns = $derived(reviewDocumentColumns(vocabulary));

  const grid = DataTable.createDataTableGrid<ReviewDocument>({
    columns: () => columns,
    rows: () => DataTable.gridRowsMatchingSearch(columns, documents ?? [], searchText),
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
      label="Search these documents"
      placeholder={placeholderOf("Search these documents")}
      fieldClass="w-2xs sm:w-xs"
      class="ms-auto"
    >
      {#snippet panel()}
        <p class="text-text-muted w-2xs p-8 text-sm sm:w-xs">
          Reaches the documents already read onto this list, by what the rows show. Words inside a
          document are Keyword, under Narrow.
        </p>
      {/snippet}
    </ScreenSearch>

    <DataTable.ClearFilters
      {grid}
      narrowing={{
        narrowed: narrowed || searching,
        summary: narrowed ? "Showing part of this review set" : "Show every document",
        clear: () => {
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
      {#snippet empty()}
        {#if narrowed || searching || grid.activeFilterCount > 0}
          <EmptyState title="Nothing Matches That">
            No document in this review set answers to what is asked. Widening the narrowing or the
            search brings them back.
          </EmptyState>
        {:else}
          <EmptyState title="Nothing Has Been Loaded Yet">
            A review set holds documents once a load has put them in it. Loads is where a delivery is
            declared and its material added; each document then enters exactly one of two terminal
            states, and everything that could not be read is named with its reason.
          </EmptyState>
        {/if}
      {/snippet}
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

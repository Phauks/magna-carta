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
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
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

  const grid = DataTable.createDataTableGrid<ReviewDocument>({
    columns: () => reviewDocumentColumns(vocabulary),
    rows: () => documents ?? [],
    rowKey: (document) => document.id,
    initialSort: REVIEW_DOCUMENT_INITIAL_SORT,
    itemNoun: { singular: "document", plural: "documents" },
    // Opening a document narrows to its family, which is the one thing this surface can do with one
    // today and is genuinely what a reviewer wants next: a message and its attachments, or an
    // archive and its entries, are read together or not understood at all. The viewer and the
    // coding panel arrive with the review surface.
    onActivate: (document) => narrow(withCriterion(criteria, "family", document.familyId)),
  });
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
  <!-- One compact action row: everything above the data that is not the data. -->
  <div class="flex items-center gap-8">
    <NarrowControl {criteria} context={{ recordCustodians: custodians, loads }} onChange={narrow} />
    <DataTable.ClearFilters
      {grid}
      narrowing={{
        narrowed,
        summary: narrowed ? "Showing part of this review set" : "Show every document",
        clear: () => {
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
        {#if narrowed || grid.activeFilterCount > 0}
          <EmptyState title="Nothing Matches That">
            No document in this review set answers to what is asked. Widening the narrowing brings
            them back.
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

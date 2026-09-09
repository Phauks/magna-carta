<script lang="ts">
  /*
   * The review-set listing — the one implementation behind both surfaces that show one.
   *
   * The matter's Discovery section and the firm-wide register ask the same question of the same
   * model at two scopes. Written twice they would drift, and the drift would be silent: two tables
   * of the same corpora disagreeing about a column, a state word, or what an empty one means.
   *
   * WHAT AN EMPTY LISTING MAY SAY IS THE CAREFUL PART. A member who is not on a review set's access
   * list gets no rows, no counts and no error naming it — the corpus is ABSENT rather than refused,
   * because "there is something here you may not see" is itself a disclosure about material that
   * may be under a protective order. So this listing must never say "this matter has no review
   * sets": for a walled-off reader that sentence is false, and a false statement about whether a
   * corpus exists is the same disclosure running the other way. The empty state says what a review
   * set IS and how one is made, and asserts nothing about what the matter holds.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import type { Snippet } from "svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { listMatterReviewSets, listReviewSets, type ReviewSet } from "./discovery-api.ts";
  import { reviewSetStateEntry } from "./discovery-vocabulary.ts";
  import {
    reviewSetColumns,
    REVIEW_SET_INITIAL_SORT,
    type MatterTitles,
  } from "./review-set-columns.ts";

  let {
    matterId = null,
    matterTitles = new Map(),
    search = "",
    caption,
    emptyTitle,
    emptyBody,
    emptyActions,
    grid = $bindable(null),
    reread = $bindable(() => {}),
    onOpen,
    onRows,
  }: {
    /** One matter's corpora, or null for every corpus this member may reach. */
    matterId?: string | null;
    /** Matter titles by identifier, for the firm-wide surface's Matter column. */
    matterTitles?: MatterTitles;
    /**
     * What the listing is searched by — the review set's own name.
     *
     * The control lives in the surface's own action row, which is where every list screen keeps it;
     * the MATCHING is the server's, in the same read that pages this list. That division is what
     * makes the answer honest on a register that is cursor-paged: narrowing the rows already
     * fetched would answer confidently about the first page of a member's corpora and call it the
     * whole record.
     */
    search?: string;
    caption: string;
    emptyTitle: string;
    emptyBody: Snippet;
    emptyActions?: Snippet;
    /** The grid, lent back so the surface's one action row can carry the clear-filters control. */
    grid?: DataTable.DataTableGridState<ReviewSet> | null;
    reread?: () => void;
    onOpen: (reviewSetId: string) => void;
    /**
     * The rows now on screen, handed to the surface after every page.
     *
     * The firm-wide register needs the matters its rows belong to so it can name them, and the
     * alternative — the surface running the same access-scoped listing a second time to find out —
     * is two reads that can disagree about which review sets exist.
     */
    onRows?: (rows: readonly ReviewSet[]) => void;
  } = $props();

  const list = new PagedList<ReviewSet>("The review sets could not be read.");
  const reviewSets = $derived(list.items);

  $effect(() => {
    const rows = reviewSets;
    if (rows !== null) onRows?.(rows);
  });

  // What this listing is currently showing. A changed scope OR a changed search is a different
  // question and therefore a fresh read from the top, never a filter over what is already here.
  const subject = $derived(`${matterId ?? "*"}|${search.trim()}`);

  function read(cursor?: string) {
    const term = search.trim() === "" ? undefined : search.trim();
    return matterId === null
      ? listReviewSets(fetch, cursor, term)
      : listMatterReviewSets(fetch, matterId, cursor, term);
  }

  $effect(() => {
    const asked = subject;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load(read);
  });

  reread = () => {
    list.reset(subject);
    void list.load(read);
  };

  const columns = $derived(reviewSetColumns({ showMatter: matterId === null, matterTitles }));

  grid = DataTable.createDataTableGrid<ReviewSet>({
    columns: () => columns,
    rows: () => reviewSets ?? [],
    rowKey: (set) => set.id,
    initialSort: REVIEW_SET_INITIAL_SORT,
    itemNoun: { singular: "review set", plural: "review sets" },
    onActivate: (set) => onOpen(set.id),
  });
  const ownGrid = grid;
</script>

{#snippet reviewSetCell({ row, column, text }: DataTable.GridCellContext<ReviewSet>)}
  {#if column.id === "state"}
    <Badge
      variant={reviewSetStateEntry(row.state).tone}
      title={reviewSetStateEntry(row.state).meaning}
    >
      {reviewSetStateEntry(row.state).label}
    </Badge>
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-16">
  {#if list.failure !== null}
    <FailureNotice
      failure={list.failure}
      title="The Review Sets Could Not Be Read"
      fallback={list.failureMessage ?? undefined}
      onRetry={reread}
    />
  {:else}
    <DataTable.Grid
      grid={ownGrid}
      class="min-h-0 flex-1"
      {caption}
      cell={reviewSetCell}
      loading={reviewSets === null}
    >
      {#snippet empty()}
        {#if (ownGrid?.activeFilterCount ?? 0) > 0 || search.trim() !== ""}
          <EmptyState title="Nothing Matches That">
            No review set here answers to what is asked. Widening the search or the filters brings
            them back.
          </EmptyState>
        {:else}
          <EmptyState title={emptyTitle} actions={emptyActions}>{@render emptyBody()}</EmptyState>
        {/if}
      {/snippet}
    </DataTable.Grid>

    <DataTable.GridFooter grid={ownGrid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="review sets"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={() => void list.loadMore(read)}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>

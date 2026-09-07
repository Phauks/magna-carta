<script lang="ts">
  /*
   * The log listing — the one implementation behind both messaging surfaces.
   *
   * The firm-wide screen and a matter's own section ask the same question of the same read at two
   * scopes: what has the firm said, and what has the firm said on this matter. Written twice they
   * would drift, and the drift would be silent — two tables of the same rows disagreeing about a
   * column, a filter, or what an empty one means. So the scope is a prop, the filters are the
   * server's own, and everything else is identical by construction.
   *
   * WHAT IS NARROWED IS A DIFFERENT QUESTION, NOT A DIFFERENT PAGE. A change of the scope PROP
   * resets the read rather than filtering the rows on screen: the listing is cursor-paged, so
   * filtering what has been loaded would answer confidently about a fraction of the log.
   *
   * THE CHROME IS THE SURFACE'S. The clear-filters control belongs to the screen's one action row,
   * so the grid is lent back to whoever mounted this listing rather than being fenced behind a
   * second strip of controls above the table.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import type { Snippet } from "svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import {
    listCommunications,
    type Communication,
    type CommunicationQuery,
  } from "./communications-api.ts";
  import {
    communicationColumns,
    COMMUNICATION_INITIAL_SORT,
    EMPTY_COMMUNICATION_VOCABULARY,
    type CommunicationVocabulary,
  } from "./communication-columns.ts";
  import { anchorStatusLabel, channelEntry, directionEntry } from "./communication-vocabulary.ts";

  let {
    query,
    vocabulary = EMPTY_COMMUNICATION_VOCABULARY,
    showMatter = true,
    caption,
    emptyTitle,
    emptyBody,
    emptyActions,
    grid = $bindable(null),
    reread = $bindable(() => {}),
    onOpen,
  }: {
    /** The server-side narrowing. A change of any field is a different question and a fresh read. */
    query: CommunicationQuery;
    /** Whatever counterparty names the surface resolved, joined here rather than per row. */
    vocabulary?: CommunicationVocabulary;
    /**
     * Whether the Matter column appears. False inside a matter, where every row is on the same one
     * and a column of one repeated value costs width and says nothing.
     */
    showMatter?: boolean;
    /** The table's accessible caption — what this particular listing is. */
    caption: string;
    /** The heading when the log genuinely holds nothing at this scope. */
    emptyTitle: string;
    /** What belongs here, said to somebody looking at nothing. */
    emptyBody: Snippet;
    /** The way out of an empty log, which is the same primary action the surface carries. */
    emptyActions?: Snippet;
    /**
     * The grid, handed back to the surface, so the clear-filters control can sit in the screen's one
     * action row rather than in a second strip above the table.
     */
    grid?: DataTable.DataTableGridState<Communication> | null;
    /** Read the log again, handed back so a surface can refresh after it writes. */
    reread?: () => void;
    /**
     * Open one call or message. The WHOLE row is handed back rather than its id: what a surface does
     * with a row depends on whether it is filed, and making the caller look the row up again would
     * mean reaching into this listing's grid for state it already had.
     */
    onOpen: (communication: Communication) => void;
  } = $props();

  const list = new PagedList<Communication>("The log could not be read.");
  const rows = $derived(list.items);
  const loadFailure = $derived(list.failure);

  // Everything the server narrows by, as one string: a change of any of them is a different question
  // about the log, so the rows on screen are discarded and read again.
  const subject = $derived(
    [
      query.matterId ?? "",
      query.scope ?? "",
      query.channel ?? "",
      (query.search ?? "").trim(),
    ].join("|"),
  );

  const narrowed = $derived(
    (query.scope !== undefined && query.scope !== "all") ||
      query.channel !== undefined ||
      (query.search ?? "").trim() !== "",
  );

  function read(cursor?: string) {
    return listCommunications(fetch, { ...query, cursor });
  }

  $effect(() => {
    const asked = subject;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load(read);
  });

  function loadMore(): void {
    void list.loadMore(read);
  }

  reread = () => {
    list.reset(subject);
    void list.load(read);
  };

  grid = DataTable.createDataTableGrid<Communication>({
    columns: () => communicationColumns(vocabulary, { showMatter }),
    rows: () => rows ?? [],
    rowKey: (communication) => communication.id,
    initialSort: COMMUNICATION_INITIAL_SORT,
    itemNoun: { singular: "call or text", plural: "calls and texts" },
    onActivate: (communication) => onOpen(communication),
  });
  // Bound out above, and read back here so the markup below does not have to narrow a nullable prop
  // on every reference. The grid is created once, at init, and never replaced.
  const ownGrid = grid;
</script>

{#snippet logCell({ row, column, text }: DataTable.GridCellContext<Communication>)}
  {#if column.id === "channel"}
    <Badge variant="neutral" title={channelEntry(row.channel).meaning}>
      {channelEntry(row.channel).label}
    </Badge>
  {:else if column.id === "direction"}
    <span title={directionEntry(row.direction).meaning}>{text}</span>
  {:else if column.id === "matter"}
    <!-- The anchor's status rides beside its name where it is worth stopping at. What may be said
         to a prospect and to a client are different things, so an intake or a consultation says so
         on the row rather than only inside the matter. -->
    {@const status = anchorStatusLabel(row)}
    <span class="flex min-w-0 items-center gap-8">
      <span class="truncate" class:text-text-muted={row.matterId === null}>{text}</span>
      {#if status !== null}
        <Badge variant="neutral">{status}</Badge>
      {/if}
    </span>
  {:else if column.id === "duration" && text === ""}
    <!-- Blank, not a dash: a text does not have a length, so there is nothing missing here. -->
    <span></span>
  {:else if column.id === "said" && row.summary === null && row.body === null}
    <span class="text-text-muted">{text}</span>
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-16">
  {#if loadFailure !== null}
    <!-- `list.failure` is the failure RECORD, so the sentence comes from `failureMessage` and the
         Error ID, the request line and the remedy come from the record itself. -->
    <FailureNotice
      failure={loadFailure}
      title="The Log Could Not Be Read"
      fallback={list.failureMessage ?? undefined}
      onRetry={reread}
    />
  {:else}
    <DataTable.Grid
      grid={ownGrid}
      class="min-h-0 flex-1"
      {caption}
      cell={logCell}
      loading={rows === null}
    >
      {#snippet empty()}
        {#if narrowed}
          <EmptyState title="Nothing Matches That">
            No call or text answers to what is asked. Widening the filters brings the log back.
          </EmptyState>
        {:else}
          <EmptyState title={emptyTitle} actions={emptyActions}>{@render emptyBody()}</EmptyState>
        {/if}
      {/snippet}
    </DataTable.Grid>

    <!-- The counts strip: how much of the log is on screen, and the way to the rest of it. One line
         at a fixed height, so it never reflows. -->
    <DataTable.GridFooter grid={ownGrid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="calls and texts"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={loadMore}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>

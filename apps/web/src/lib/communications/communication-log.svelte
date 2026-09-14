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
   * THE DESCRIPTION IS THE ROW'S SECOND LINE, NOT A COLUMN (owner ruling, 2026-09-08). It is prose,
   * and usually longer than every other fact on the row put together — as a column it was either
   * truncated to a few words, which is not a description, or wide enough to push the facts off the
   * screen. So it takes the row's whole width underneath the facts and wraps there, through the one
   * table's own row-detail, which is exactly what the time sheet does with its own description.
   *
   * THE CHROME IS THE SURFACE'S. The clear-filters control belongs to the screen's one action row,
   * so the grid is lent back to whoever mounted this listing rather than being fenced behind a
   * second strip of controls above the table.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
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
  import {
    anchorStatusLabel,
    channelEntry,
    directionEntry,
    saidText,
  } from "./communication-vocabulary.ts";

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
  {:else if column.id === "referenceNumber"}
    <span class="tabular-nums" class:text-text-muted={row.referenceNumber === null}>{text}</span>
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<!-- The row's second line: the whole description, wrapping across the row's own width. A row with
     nothing written says so quietly rather than leaving a blank line, which would read as a record
     the platform failed to fill. -->
{#snippet rowDetail(row: Communication)}
  {@const said = saidText(row)}
  {#if said !== ""}
    <p
      class="w-full whitespace-pre-wrap text-sm"
      class:text-text-muted={row.summary === null && row.body === null}
    >
      {said}
    </p>
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
      {rowDetail}
      loading={rows === null}
    >
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

<script lang="ts">
  /*
   * The register listing — the one implementation behind both custody surfaces.
   *
   * The firm-wide screen and a matter's own section ask the same question of the same read at two
   * scopes: what does the firm hold, and what does the firm hold for this matter. Written twice
   * they would drift, and the drift would be silent — two tables of the same rows disagreeing about
   * a column, a filter, or what an empty one means. So the scope is a prop, the filters are the
   * server's own, and everything else is identical by construction.
   *
   * WHAT IS NARROWED IS A DIFFERENT QUESTION, NOT A DIFFERENT PAGE. A change of the scope PROP
   * resets the read rather than filtering the rows on screen: the listing is cursor-paged, so
   * filtering what has been loaded would answer confidently about a fraction of the register. The
   * grid's own per-column filters do run over the loaded rows, and the footer strip says what its
   * counts are counting rather than a sentence under the table saying it.
   *
   * THE CHROME IS THE SURFACE'S. The show/hide-columns and clear-filters controls belong to the
   * screen's one action row, so the grid is lent back to whoever mounted this listing rather than
   * being fenced behind a second strip of controls above the table.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import type { Snippet } from "svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import {
    listCustodyPackets,
    type CustodyLocationNode,
    type CustodyPacketQuery,
    type CustodyPacketSummary,
  } from "./custody-api.ts";
  import {
    custodyPacketColumns,
    custodyRegisterVocabulary,
    CUSTODY_REGISTER_INITIAL_SORT,
    EMPTY_CUSTODY_VOCABULARY,
  } from "./packet-columns.ts";
  import { packetStatusEntry } from "./custody-vocabulary.ts";

  let {
    query,
    locations,
    caption,
    emptyTitle,
    emptyBody,
    emptyActions,
    grid = $bindable(null),
    reread = $bindable(() => {}),
    onOpenPacket,
  }: {
    /** The server-side narrowing. A change of any field is a different question and a fresh read. */
    query: CustodyPacketQuery;
    /** The firm's container tree, read once by the surface and joined here. */
    locations: readonly CustodyLocationNode[];
    /** The table's accessible caption — what this particular listing is. */
    caption: string;
    /** The heading when the register genuinely holds nothing at this scope. */
    emptyTitle: string;
    /** What belongs here, said to somebody looking at nothing. */
    emptyBody: Snippet;
    /** The way out of an empty register, which is the same primary action the surface carries. */
    emptyActions?: Snippet;
    /**
     * The grid, handed back to the surface.
     *
     * The show/hide-columns control and the clear-filters control belong to the screen's one action
     * row rather than to a second strip above the table (the compact-action-row ruling in
     * docs/conventions/design-corrections.md), and both of them need this. Owning the grid here and
     * lending it out keeps the listing the one implementation while letting the chrome sit where a
     * reader looks for chrome.
     */
    grid?: DataTable.DataTableGridState<CustodyPacketSummary> | null;
    /** Read the register again, handed back so a surface can refresh after it writes. */
    reread?: () => void;
    /**
     * Open one packet. The window itself belongs to the surface rather than to this listing, so
     * every panel that names a packet opens the SAME window instead of each carrying its own.
     */
    onOpenPacket: (packetId: string) => void;
  } = $props();

  const list = new PagedList<CustodyPacketSummary>("The register could not be read.");
  const packets = $derived(list.items);
  const loadFailure = $derived(list.failure);

  // Everything the server narrows by, as one string: a change of any of them is a different
  // question about the register, so the rows on screen are discarded and read again.
  const subject = $derived(
    [
      query.matterId ?? "",
      query.status ?? "",
      query.ownerEntityId ?? "",
      query.locationSubtreeId ?? "",
      (query.search ?? "").trim(),
    ].join("|"),
  );

  const narrowed = $derived(
    query.status !== undefined ||
      query.ownerEntityId !== undefined ||
      query.locationSubtreeId !== undefined ||
      (query.search ?? "").trim() !== "",
  );

  function read(cursor?: string) {
    return listCustodyPackets(fetch, { ...query, cursor });
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

  const vocabulary = $derived(
    locations.length === 0 ? EMPTY_CUSTODY_VOCABULARY : custodyRegisterVocabulary(locations),
  );
  grid = DataTable.createDataTableGrid<CustodyPacketSummary>({
    columns: () => custodyPacketColumns(vocabulary),
    rows: () => packets ?? [],
    rowKey: (packet) => packet.id,
    initialSort: CUSTODY_REGISTER_INITIAL_SORT,
    itemNoun: { singular: "packet", plural: "packets" },
    onActivate: (packet) => onOpenPacket(packet.id),
  });
  // Bound out above, and read back here so the markup below does not have to narrow a nullable
  // prop on every reference. The grid is created once, at init, and never replaced.
  const ownGrid = grid;
</script>

{#snippet packetCell({ row, column, text }: DataTable.GridCellContext<CustodyPacketSummary>)}
  {#if column.id === "custodyNumber"}
    <!-- Tabular figures: a custody number is read down a column, written on a label, and read
         aloud over the phone. -->
    <span class="tabular-nums">{text}</span>
  {:else if column.id === "status"}
    <Badge
      variant={packetStatusEntry(row.status).tone}
      title={packetStatusEntry(row.status).meaning}
    >
      {packetStatusEntry(row.status).label}
    </Badge>
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-16">
  {#if loadFailure !== null}
    <!-- `list.failure` is the failure RECORD, so the sentence comes from `failureMessage` and the
         Error ID, the request line and the remedy come from the record itself. Rendering the record
         where a sentence belongs prints an object at the reader. -->
    <FailureNotice
      failure={loadFailure}
      title="The Register Could Not Be Read"
      fallback={list.failureMessage ?? undefined}
      onRetry={reread}
    />
  {:else}
    <DataTable.Grid
      grid={ownGrid}
      class="min-h-0 flex-1"
      {caption}
      cell={packetCell}
      loading={packets === null}
    >
      {#snippet empty()}
        {#if narrowed}
          <EmptyState title="Nothing Matches That">
            No packet on the firm's register answers to what is asked. Widening the filters brings
            the register back.
          </EmptyState>
        {:else}
          <EmptyState title={emptyTitle} actions={emptyActions}>{@render emptyBody()}</EmptyState>
        {/if}
      {/snippet}
    </DataTable.Grid>

    <!-- The counts strip: how much of the register is on screen, and the way to the rest of it.
         One line at a fixed height, so it never reflows. -->
    <DataTable.GridFooter grid={ownGrid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="packets"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={loadMore}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>

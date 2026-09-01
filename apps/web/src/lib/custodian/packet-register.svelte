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
   * WHAT IS NARROWED IS A DIFFERENT QUESTION, NOT A DIFFERENT PAGE. A change of filter resets the
   * read rather than filtering the rows on screen: the listing is cursor-paged, so filtering what
   * has been loaded would answer confidently about a fraction of the register. The grid's own
   * per-column filters do run over the loaded rows, which is why the line under Load more says so.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import type { Snippet } from "svelte";
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
    /**
     * Open one packet. The window itself belongs to the surface rather than to this listing, so
     * every panel that names a packet — this one, the overdue list, what is due — opens the SAME
     * window instead of each carrying its own.
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

  function reread(): void {
    list.reset(subject);
    void list.load(read);
  }

  const vocabulary = $derived(
    locations.length === 0 ? EMPTY_CUSTODY_VOCABULARY : custodyRegisterVocabulary(locations),
  );
  const grid = DataTable.createDataTableGrid<CustodyPacketSummary>({
    columns: () => custodyPacketColumns(vocabulary),
    rows: () => packets ?? [],
    rowKey: (packet) => packet.id,
    initialSort: CUSTODY_REGISTER_INITIAL_SORT,
    itemNoun: { singular: "packet", plural: "packets" },
    onActivate: (packet) => onOpenPacket(packet.id),
  });
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

<div class="flex flex-col gap-16">
  {#if loadFailure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>The Register Could Not Be Read</Alert.Title>
      <Alert.Description>
        {loadFailure}
        <Button variant="secondary" class="mt-8" onclick={reread}>
          <RotateCcw class="size-16" aria-hidden="true" />
          Try again
        </Button>
      </Alert.Description>
    </Alert.Root>
  {:else}
    <DataTable.Grid {grid} {caption} cell={packetCell} loading={packets === null}>
      {#snippet empty()}
        {#if narrowed}
          <EmptyState title="Nothing Matches That">
            No packet on the firm's register answers to what is asked. Widening the filters brings
            the register back.
          </EmptyState>
        {:else}
          <EmptyState title={emptyTitle}>{@render emptyBody()}</EmptyState>
        {/if}
      {/snippet}
    </DataTable.Grid>

    <DataTable.GridFooter {grid} />

    {#if list.nextCursor !== null}
      <div class="flex flex-col items-start gap-8">
        <Button variant="secondary" onclick={loadMore} disabled={list.loadingMore}>
          {list.loadingMore ? "Loading" : "Load more packets"}
        </Button>
        <p class="text-xs text-text-muted">
          The register continues past what is on screen. Sorting and the column filters run over the
          packets loaded so far, so the counts below the table are counts of these rows, not of the
          whole register.
        </p>
      </div>
    {/if}
  {/if}
</div>

<script lang="ts">
  /*
   * One item's chain of custody.
   *
   * WHY AN ITEM HAS A HISTORY OF ITS OWN AT ALL. The packet is what moves, but the question a firm
   * gets asked is about the object: where has this will been, and who has had it. A packet routinely
   * holds several instruments, is opened and added to over decades, and outlives the reason it was
   * made — so a history that could only be read for the whole envelope would answer the question
   * about the box rather than the one about the will.
   *
   * IT IS THE SAME LEDGER, ASKED WITH ONE MORE FILTER, and that matters more than it sounds: an item
   * has no separate record to drift from the packet's. The server answers this item's own entries
   * PLUS the packet-wide ones, because an item goes wherever its packet goes, and each packet-wide
   * entry says so on its face rather than being quietly presented as though it were about the item
   * alone. What a reader must never have to do is work out which is which.
   *
   * READ WHEN OPENED, NOT WHEN LISTED. A packet with nine items would otherwise make nine ledger
   * reads to draw a list nobody has asked a question of yet.
   */
  import Button from "@magna-carta/design-system/button";
  import EventRail, { orderedOldestFirst } from "@magna-carta/design-system/event-rail";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { listCustodyMovements, type CustodyMovement } from "./custody-api.ts";
  import { movementEvents, type CustodyNameLookup } from "./custody-movements.ts";

  let {
    packetId,
    itemId,
    label,
    names,
  }: {
    packetId: string;
    /** The item whose history this is. */
    itemId: string;
    /** What this item is, for the rail's accessible name. */
    label: string;
    /** How the surrounding window resolves the handles on a ledger row. */
    names: CustodyNameLookup;
  } = $props();

  const list = new PagedList<CustodyMovement>("This item's history could not be read.");
  const movements = $derived(list.items);

  function read(cursor?: string) {
    return listCustodyMovements(fetch, packetId, { itemId, cursor });
  }

  $effect(() => {
    const asked = `${packetId}:${itemId}`;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load(read);
  });

  // The rail renders the order it is handed, and the ledger arrives newest first.
  const events = $derived(
    movements === null ? [] : orderedOldestFirst(movementEvents(movements, names, "item")),
  );
</script>

<div class="flex flex-col gap-8">
  {#if list.failure !== null}
    <FailureNotice
      failure={list.failure}
      title="This Item's History Could Not Be Read"
      fallback={list.failureMessage ?? undefined}
      onRetry={() => {
        list.reset(`${packetId}:${itemId}`);
        void list.load(read);
      }}
    />
  {:else}
    <EventRail
      {events}
      label="The chain of custody for {label}"
      loading={movements === null}
      loadingMessage="Reading this item's chain of custody"
      emptyMessage="Nothing has been recorded against this item yet."
    />

    {#if list.nextCursor !== null}
      <div class="flex">
        <Button
          variant="secondary"
          size="sm"
          disabled={list.loadingMore}
          onclick={() => void list.loadMore(read)}
        >
          {list.loadingMore ? "Loading" : "Load earlier entries"}
        </Button>
      </div>
    {/if}
  {/if}
</div>

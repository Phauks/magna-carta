<script lang="ts">
  /*
   * Every hold standing across the register, oldest first.
   *
   * A hold nobody can see is a hold nobody will remember to release, and a packet stuck behind a
   * forgotten hold can never be returned to the person it belongs to. That is the whole reason this
   * is a standing report rather than only a refusal somebody hits: the register's holds are visible
   * as a list, with what each one forbids stated in the same words the packet uses.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { listCustodyHoldsInForce, type CustodyPacketUnderHold } from "./custody-api.ts";
  import { holdLabel, holdMeaning, packetStatusEntry } from "./custody-vocabulary.ts";

  const list = new PagedList<CustodyPacketUnderHold>("The holds in force could not be read.");
  const holds = $derived(list.items);

  // Bumped by Retry, so a failed read is re-run rather than left for the member to reload the page.
  let attempt = $state(0);

  $effect(() => {
    const subject = `holds:${attempt}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    void list.load((cursor) => listCustodyHoldsInForce(fetch, cursor));
  });
</script>

<div class="flex flex-col gap-16">
  {#if list.failure !== null}
    <FailureNotice
      failure={list.failure}
      subject="The holds in force"
      fallback={list.failureMessage ?? undefined}
      onRetry={() => (attempt += 1)}
    />
  {:else if holds === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading the holds in force">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if holds.length === 0}
    <EmptyState title="No Holds In Force">
      A hold forbids property leaving the firm's custody or ceasing to exist. Nothing on the register
      is held back today.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Holds standing across the register</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Custody Number</DataTable.Head>
          <DataTable.Head>Hold</DataTable.Head>
          <DataTable.Head>Scope</DataTable.Head>
          <DataTable.Head>Packet</DataTable.Head>
          <DataTable.Head>Placed</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each holds as hold (hold.holdId)}
          <DataTable.Row>
            <DataTable.Cell><span class="tabular-nums">{hold.custodyNumber}</span></DataTable.Cell>
            <DataTable.Cell>
              <Badge variant="warning" title={holdMeaning(hold.kind)}>{holdLabel(hold.kind)}</Badge>
            </DataTable.Cell>
            <DataTable.Cell>
              {hold.itemId === null ? "The whole packet" : "One item"}
            </DataTable.Cell>
            <DataTable.Cell>
              <Badge
                variant={packetStatusEntry(hold.packetStatus).tone}
                title={packetStatusEntry(hold.packetStatus).meaning}
              >
                {packetStatusEntry(hold.packetStatus).label}
              </Badge>
            </DataTable.Cell>
            <DataTable.Cell>{formatInstant(hold.placedAt)}</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>

    {#if list.nextCursor !== null}
      <div class="flex flex-col items-start gap-8">
        <Button
          variant="secondary"
          disabled={list.loadingMore}
          onclick={() => void list.loadMore((cursor) => listCustodyHoldsInForce(fetch, cursor))}
        >
          {list.loadingMore ? "Loading" : "Load more holds"}
        </Button>
      </div>
    {/if}
  {/if}
</div>

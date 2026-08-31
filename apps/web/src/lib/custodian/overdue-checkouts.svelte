<script lang="ts">
  /*
   * What is out past its due-back date, most overdue first.
   *
   * This is the day-to-day signal a custody register exists to produce: a deed that went to a
   * completion meeting three weeks ago and has not come back is the failure the whole subsystem is
   * built to catch early. So it is a surface of its own rather than a filter on the register, and it
   * leads with how long rather than with the date, because the number of days is what tells a person
   * which row to act on first.
   *
   * WHO HAS IT, AS FAR AS THE READ CAN SAY. The overdue read answers the KIND of borrower — a
   * member, someone in the directory, a named individual — and not the person. Naming them is one
   * read per row against a directory that serves one entity per request, which is exactly the read
   * this product does not make from a listing. The packet's own history names them, which is what
   * opening the row is for.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { listOverdueCustodyCheckouts, type OverdueCustodyCheckout } from "./custody-api.ts";
  import { borrowerKindLabel } from "./custody-vocabulary.ts";

  let { onOpenPacket }: { onOpenPacket: (packetId: string) => void } = $props();

  const list = new PagedList<OverdueCustodyCheckout>("The overdue check-outs could not be read.");
  const overdue = $derived(list.items);

  // Bumped by Retry, so a failed read is re-run rather than left for the member to reload the page.
  let attempt = $state(0);

  $effect(() => {
    const subject = `overdue:${attempt}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    void list.load((cursor) => listOverdueCustodyCheckouts(fetch, cursor));
  });

  /**
   * How loudly a row reads. This is a READING AID and not the register's own bucketing: the coarse
   * buckets are the reminder read's, which answers them itself, and a second copy of those
   * thresholds here would be two definitions of "overdue" that eventually disagree. All this
   * decides is that a month out looks different from a week out.
   */
  const LOUD_AFTER_DAYS = 30;

  function toneOf(daysOverdue: number): "warning" | "danger" {
    return daysOverdue > LOUD_AFTER_DAYS ? "danger" : "warning";
  }
</script>

<div class="flex flex-col gap-16">
  {#if list.failure !== null}
    <FailureNotice
      failure={list.failure}
      subject="The overdue check-outs"
      fallback={list.failureMessage ?? undefined}
      onRetry={() => (attempt += 1)}
    />
  {:else if overdue === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading the overdue check-outs">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if overdue.length === 0}
    <EmptyState title="Nothing Is Overdue">
      Every packet that is out is out within the date somebody said it would be back. A check-out
      with no due-back date recorded never appears here, because there is nothing for it to be past.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Check-outs past their due-back date</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Custody Number</DataTable.Head>
          <DataTable.Head data-align="end">Days overdue</DataTable.Head>
          <DataTable.Head>Due back</DataTable.Head>
          <DataTable.Head>With</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each overdue as row (row.packetId)}
          <DataTable.Row>
            <DataTable.Cell>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => onOpenPacket(row.packetId)}
              >
                <span class="tabular-nums">{row.custodyNumber}</span>
              </Button>
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              <Badge variant={toneOf(row.daysOverdue)}>
                <span class="tabular-nums">{row.daysOverdue}</span>
              </Badge>
            </DataTable.Cell>
            <DataTable.Cell><span class="tabular-nums">{row.dueBackOn}</span></DataTable.Cell>
            <DataTable.Cell>
              {row.borrowerKind === null
                ? "Not recorded"
                : borrowerKindLabel(row.borrowerKind)}
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>

    <p class="text-xs text-text-muted">
      Who has each packet is named on its own history, not here: naming them on a listing would be
      one directory read per row.
    </p>

    {#if list.nextCursor !== null}
      <div class="flex flex-col items-start gap-8">
        <Button
          variant="secondary"
          disabled={list.loadingMore}
          onclick={() => void list.loadMore((cursor) => listOverdueCustodyCheckouts(fetch, cursor))}
        >
          {list.loadingMore ? "Loading" : "Load more overdue packets"}
        </Button>
        <p class="text-xs text-text-muted">
          Paging forward walks toward the merely late: the most overdue are on the first page.
        </p>
      </div>
    {/if}
  {/if}
</div>

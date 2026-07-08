<script lang="ts">
  /*
   * Matter time — time captured against the matter, presented from fixtures so the table
   * teaches the real shape (date, timekeeper, narrative, hours, amount in the ledger money
   * voice). A non-billable entry shows an em dash for its amount — no charge is a statement,
   * not a zero. Presentation only; timers and entry arrive with the time-tracking surface.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import type { MatterFixture, TimeEntryFixtureRow } from "$lib/matters/fixtures.ts";

  let { data }: { data: { matter: MatterFixture } } = $props();

  const matter = $derived(data.matter);

  function entryAmount(entry: TimeEntryFixtureRow): string {
    if (!entry.billable) return "—";
    return DataTable.formatMoney(entry.amountMinor / 100);
  }
</script>

<svelte:head>
  <title>Time · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <h2
    class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Time
  </h2>

  {#if matter.timeEntries.length === 0}
    <EmptyState title="No time recorded yet">
      Timers, manual entries, and the weekly grid all land here, billable or not. Time capture
      arrives with the time-tracking surface.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Time recorded on this matter</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Date</DataTable.Head>
          <DataTable.Head>Timekeeper</DataTable.Head>
          <DataTable.Head>Narrative</DataTable.Head>
          <DataTable.Head data-align="end">Hours</DataTable.Head>
          <DataTable.Head data-align="end">Amount</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each matter.timeEntries as entry (entry.date + entry.narrative)}
          <DataTable.Row>
            <DataTable.Cell>{DataTable.formatDate(entry.date)}</DataTable.Cell>
            <DataTable.Cell>{entry.timekeeperName}</DataTable.Cell>
            <DataTable.Cell>{entry.narrative}</DataTable.Cell>
            <DataTable.Cell data-align="end">{entry.hours.toFixed(1)}</DataTable.Cell>
            <DataTable.Cell data-align="end">{entryAmount(entry)}</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/if}
</section>

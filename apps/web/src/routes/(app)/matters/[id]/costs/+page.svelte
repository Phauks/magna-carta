<script lang="ts">
  /*
   * Matter costs — costs advanced and expenses incurred, presented from fixtures so the table
   * teaches the real shape (date, description, category, amount in the ledger money voice).
   * A non-billable cost shows an em dash for its amount. Presentation only; cost entry and the
   * recoverable treatment arrive with the costs surface.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import type { CostFixtureRow, MatterFixture } from "$lib/matters/fixtures.ts";

  let { data }: { data: { matter: MatterFixture } } = $props();

  const matter = $derived(data.matter);

  function costAmount(cost: CostFixtureRow): string {
    if (!cost.billable) return "—";
    return DataTable.formatMoney(cost.amountMinor / 100);
  }
</script>

<svelte:head>
  <title>Costs · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <h2
    class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Costs
  </h2>

  {#if matter.costs.length === 0}
    <EmptyState title="No costs yet">
      Filing fees, service, experts — every cost advanced for this matter is recorded here with
      its billable treatment. Cost entry arrives with the costs surface.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Costs recorded on this matter</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Date</DataTable.Head>
          <DataTable.Head>Description</DataTable.Head>
          <DataTable.Head>Category</DataTable.Head>
          <DataTable.Head data-align="end">Amount</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each matter.costs as cost (cost.date + cost.description)}
          <DataTable.Row>
            <DataTable.Cell>{DataTable.formatDate(cost.date)}</DataTable.Cell>
            <DataTable.Cell>{cost.description}</DataTable.Cell>
            <DataTable.Cell>{cost.category}</DataTable.Cell>
            <DataTable.Cell data-align="end">{costAmount(cost)}</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/if}
</section>

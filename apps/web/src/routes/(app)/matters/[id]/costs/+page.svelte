<script lang="ts">
  /*
   * The matter's costs — every disbursement advanced for it, read from the firm's own record.
   *
   * The whole record, not one slice: the listing is asked without a status, so approved, invoiced
   * and voided costs appear beside the drafts. A matter that has been billing for a year showed
   * almost nothing when this read only its drafts.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has
   * no firm behind it and therefore no costs to read; it says so rather than showing an empty
   * table, because "no costs" and "not a real matter" are different facts.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Plus from "@lucide/svelte/icons/plus";
  import {
    costTotals,
    disbursementLabel,
    listMatterCosts,
    statusLabel,
    statusTone,
    type CostSummary,
  } from "$lib/matters/cost-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  let costs = $state<readonly CostSummary[] | null>(null);
  let loadFailure = $state<string | null>(null);

  $effect(() => {
    const matterId = matter.id;
    // The previous matter's answer is discarded before the next one is asked for. Left standing, a
    // failure is attributed to the matter now on screen and a table is read as that matter's own.
    costs = null;
    loadFailure = null;
    if (isSample) {
      costs = [];
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await listMatterCosts(fetch, matterId);
      if (cancelled) return;
      if (result.kind === "ok") {
        costs = result.value.data;
        loadFailure = null;
      } else if (result.kind === "transport") {
        costs = [];
        loadFailure = "Nothing answered. The costs on this matter could not be read.";
      } else {
        costs = [];
        loadFailure = result.problem.detail ?? "The costs on this matter could not be read.";
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const totals = $derived(costTotals(costs ?? []));

  function vendorOf(cost: CostSummary): string | null {
    if (cost.vendorName !== null && cost.vendorName !== undefined) return cost.vendorName;
    return null;
  }
</script>

<svelte:head>
  <title>Costs · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <div class="flex flex-col gap-8 border-b border-border-strong pb-8">
    <div class="flex items-center justify-between gap-16">
      <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Costs
      </h2>
      <div class="flex items-center gap-8">
        <Badge variant="neutral">Soon</Badge>
        <Button variant="secondary" disabled>
          <Plus aria-hidden="true" />
          Record a cost
        </Button>
      </div>
    </div>
    <p class="text-xs text-text-muted">
      Recording a cost from this screen waits on the vendor picker, so a payee is chosen from the
      firm's directory rather than typed twice. Costs already advanced for this matter are read here
      now, in every status.
    </p>
  </div>

  {#if loadFailure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>Costs Could Not Be Read</Alert.Title>
      <Alert.Description>{loadFailure}</Alert.Description>
    </Alert.Root>
  {:else if costs === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Loading the matter's costs">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if isSample}
    <EmptyState title="No Costs On A Sample Matter">
      This is one of the sample matters the interface is reviewed against. It has no firm behind it,
      so there are no costs to read.
    </EmptyState>
  {:else if costs.length === 0}
    <EmptyState title="No Costs Yet">
      Filing fees, service, court reporters, experts. Every cost advanced for this matter is
      recorded here with the vendor it went to and whether the client may be asked for it.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Costs advanced for this matter</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Date</DataTable.Head>
          <DataTable.Head>Description</DataTable.Head>
          <DataTable.Head>Vendor</DataTable.Head>
          <DataTable.Head>Class</DataTable.Head>
          <DataTable.Head>Status</DataTable.Head>
          <DataTable.Head data-align="end">Amount</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each costs as cost (cost.id)}
          <DataTable.Row>
            <DataTable.Cell>{DataTable.formatDate(cost.incurredDate)}</DataTable.Cell>
            <DataTable.Cell>{cost.description}</DataTable.Cell>
            <DataTable.Cell>
              {#if vendorOf(cost) === null}
                <span class="text-text-muted">
                  {cost.vendorId === null ? "Not recorded" : "No longer in the directory"}
                </span>
              {:else}
                {vendorOf(cost)}
              {/if}
            </DataTable.Cell>
            <DataTable.Cell>{disbursementLabel(cost.disbursementClass)}</DataTable.Cell>
            <DataTable.Cell>
              <Badge variant={statusTone(cost.status)}>{statusLabel(cost.status)}</Badge>
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              {DataTable.formatMoney(cost.amountMinor / 100)}
              {#if !cost.billable}
                <span class="text-text-muted"> (absorbed)</span>
              {/if}
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>

    <p class="text-xs text-text-muted">
      Advanced for this matter: {DataTable.formatMoney(totals.advancedMinor / 100)}, of which
      {DataTable.formatMoney(totals.recoverableMinor / 100)} is recoverable from the client. The
      difference is what the firm has decided to absorb. Voided costs are excluded, because a
      withdrawn cost was never advanced.
    </p>
  {/if}
</section>

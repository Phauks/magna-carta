<script lang="ts">
  /*
   * The matter's costs — every cost paid or consumed for it, read from the firm's own record.
   *
   * The whole record, not one slice: the listing is asked without a status, so approved, billed and
   * voided costs appear beside the drafts. A matter that has been billing for a year showed almost
   * nothing when this read only its drafts.
   *
   * This page is the read and the state set; the ledger itself is the surface below it. A SAMPLE
   * matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no firm
   * behind it and therefore no costs to read; it says so rather than showing an empty table,
   * because "no costs recorded" and "not a real matter" are different facts.
   *
   * A FAILED READ KEEPS ITS EVIDENCE. The failing request, the answer, the moment and the
   * correlation handle travel on the failure record itself rather than being held in four separate
   * pieces of page state, because they are what a person needs to report the failure and what
   * support needs to find it.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import CostLedger from "$lib/costs/cost-ledger.svelte";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import FailureScreen from "$lib/diagnostics/failure-screen.svelte";
  import ReportDialog from "$lib/diagnostics/report-dialog.svelte";
  import { gapReason } from "$lib/costs/cost-gaps.ts";
  import { listMatterCostLedger, type CostLedgerEntry } from "$lib/costs/cost-operations.ts";
  import Button from "@magna-carta/design-system/button";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const list = new PagedList<CostLedgerEntry>("The costs on this matter could not be read.");
  const costs = $derived(list.items);
  const loadFailure = $derived(list.failure);

  let permissions = $state<readonly string[] | null>(null);
  // Bumped after a write, so the ledger re-reads what the server now holds rather than guessing.
  let reloadToken = $state(0);
  let reportOpen = $state(false);

  $effect(() => {
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") permissions = outcome.value.permissions;
    })();
  });

  $effect(() => {
    const matterId = matter.id;
    const token = reloadToken;
    if (list.showing(`${matterId}:${String(token)}`)) return;
    list.reset(`${matterId}:${String(token)}`);
    if (isSample) {
      list.settleEmpty();
      return;
    }
    void list.load((cursor) => listMatterCostLedger(fetch, matter.id, cursor));
  });

  function loadMore(): void {
    void list.loadMore((cursor) => listMatterCostLedger(fetch, matter.id, cursor));
  }
</script>

<svelte:head>
  <title>Costs · {matter.title} · Magna Carta</title>
</svelte:head>

{#if loadFailure !== null}
  <FailureScreen
    failure={loadFailure}
    scale="screen"
    subject="The costs"
    fallback={list.failureMessage ?? undefined}
    reassurance="The record itself is unaffected: nothing was changed by this failure, and the costs
      are still on the firm's record."
    onRetry={() => (reloadToken += 1)}
    onReport={() => (reportOpen = true)}
  />
  <ReportDialog
    bind:open={reportOpen}
    errorId={list.failureErrorId}
    route={loadFailure.request}
    screenshotReason={gapReason("screenshot")}
  />
{:else if isSample}
  <section class="flex flex-col gap-16">
    <Alert.Root variant="info">
      <Alert.Title>This is a sample matter.</Alert.Title>
      <Alert.Description>
        It exists so the matter screens stay reviewable at a stable address; there is no firm record
        behind it, so it holds no costs and nothing can be recorded against it. Open one of the
        firm's own matters to use this surface.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <!-- The ledger takes the rest of the screen and keeps it: the table scrolls inside itself and
       the counts footer stays on the bottom, so the page does not grow taller as costs arrive. -->
  <FullHeightSection>
    <CostLedger
      costs={costs ?? []}
      loading={costs === null}
      matterId={matter.id}
      matterTitle={matter.title}
      matterNumber={matter.matterNumber}
      {permissions}
      onChanged={() => (reloadToken += 1)}
    />
    {#if list.nextCursor !== null}
      <div class="flex flex-none flex-col items-start gap-8 pt-12 pb-24">
        <Button variant="secondary" onclick={loadMore} disabled={list.loadingMore}>
          {list.loadingMore ? "Loading" : "Load more costs"}
        </Button>
        <p class="text-xs text-text-muted">
          Showing the {(costs ?? []).length} most recently incurred. The figures above cover only what is
          loaded, so they are not the matter's whole cost record until every page is read.
        </p>
      </div>
    {/if}
  </FullHeightSection>
{/if}

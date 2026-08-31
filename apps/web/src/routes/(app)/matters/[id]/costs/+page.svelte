<script lang="ts">
  /*
   * The matter's costs — every disbursement advanced or charged back for it, read from the firm's
   * own record.
   *
   * The whole record, not one slice: the listing is asked without a status, so approved, billed and
   * voided costs appear beside the drafts. A matter that has been billing for a year showed almost
   * nothing when this read only its drafts.
   *
   * This page is the read and the state set; the ledger itself is the surface below it. A SAMPLE
   * matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no firm
   * behind it and therefore no costs to read; it says so rather than showing an empty table,
   * because "no costs advanced" and "not a real matter" are different facts.
   *
   * A FAILED READ KEEPS ITS EVIDENCE. The failing request, the answer, the moment and the
   * correlation handle are held here rather than collapsed into one sentence, because they are what
   * a person needs to report the failure and what support needs to find it.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import CostErrorState from "$lib/costs/cost-error-state.svelte";
  import CostLedger from "$lib/costs/cost-ledger.svelte";
  import CostProblemReportDialog from "$lib/costs/cost-problem-report-dialog.svelte";
  import { listMatterCostLedger, type CostLedgerEntry } from "$lib/costs/cost-operations.ts";
  import Button from "@magna-carta/design-system/button";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import type { ApiOutcome, Page } from "$lib/api/request.ts";
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

  /* What the last failed read answered, kept so the error surface can hand it to a report. */
  let failureStatus = $state<number | null>(null);
  let failureErrorId = $state<string | null>(null);
  let failedAt = $state(new Date());
  let reportOpen = $state(false);

  const request = $derived(`GET /api/v1/costs?matterId=${matter.id}`);

  $effect(() => {
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") permissions = outcome.value.permissions;
    })();
  });

  /* One read, wrapped so the problem behind a failure survives the paging state's summary of it. */
  async function read(cursor?: string): Promise<ApiOutcome<Page<CostLedgerEntry>>> {
    const outcome = await listMatterCostLedger(fetch, matter.id, cursor);
    if (outcome.kind === "ok") {
      failureStatus = null;
      failureErrorId = null;
      return outcome;
    }
    failedAt = new Date();
    failureStatus = outcome.kind === "problem" ? outcome.problem.status : null;
    failureErrorId = outcome.kind === "problem" ? (outcome.problem.errorId ?? null) : null;
    return outcome;
  }

  $effect(() => {
    const matterId = matter.id;
    const token = reloadToken;
    if (list.showing(`${matterId}:${String(token)}`)) return;
    list.reset(`${matterId}:${String(token)}`);
    if (isSample) {
      list.settleEmpty();
      return;
    }
    void list.load(read);
  });

  function loadMore(): void {
    void list.loadMore(read);
  }
</script>

<svelte:head>
  <title>Costs · {matter.title} · Magna Carta</title>
</svelte:head>

{#if loadFailure !== null}
  <CostErrorState
    detail={loadFailure}
    {request}
    status={failureStatus}
    errorId={failureErrorId}
    {failedAt}
    onRetry={() => (reloadToken += 1)}
    onReport={() => (reportOpen = true)}
  />
  <CostProblemReportDialog bind:open={reportOpen} errorId={failureErrorId} route={request} />
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
    <div class="mt-12 flex flex-col items-start gap-8">
      <Button variant="secondary" onclick={loadMore} disabled={list.loadingMore}>
        {list.loadingMore ? "Loading" : "Load more costs"}
      </Button>
      <p class="text-xs text-text-muted">
        Showing the {(costs ?? []).length} most recently incurred. The figures below cover only what is
        loaded, so they are not the matter's whole cost record until every page is read.
      </p>
    </div>
  {/if}
{/if}

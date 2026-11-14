<script lang="ts">
  /*
   * The matter's Fees section: the work-in-progress fee ledger and the fee agreement, at the same
   * level as Time and Costs. A fee is a flat charge for professional services — its own dated draft
   * with a timekeeper, a description, an amount and a billing disposition — and it reaches a bill
   * the same way a cost does: a draft invoice claims it. Bills themselves live in Billing.
   *
   * The arrangement read rides the same billing state the Billing section reads, so the two
   * sections cannot disagree about what the matter's fee agreement says. The ledger renders inside
   * the money surface, which takes the rest of the screen and keeps it; the page's part is the
   * read and the state set.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import FailureScreen from "$lib/diagnostics/failure-screen.svelte";
  import ReportDialog from "$lib/diagnostics/report-dialog.svelte";
  import FeeLedger from "$lib/billing/fee-ledger.svelte";
  import { listMatterFeeLedger } from "$lib/billing/fee-operations.ts";
  import { MatterBilling } from "$lib/billing/matter-billing.svelte.ts";
  import type { FeeRecord } from "$lib/billing/fee-record.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const billing = new MatterBilling();
  const rows = $derived(billing.rows);
  const failure = $derived(billing.failure);

  /*
   * The matter's fees, read whole: every status, so a matter that has been billing for a year shows
   * its billed charges beside its drafts. Narrowing to one status answers the work-in-progress
   * question a bill composer asks, not the question a fee ledger is for.
   */
  const list = new PagedList<FeeRecord>("The fees on this matter could not be read.");
  const fees = $derived(list.items);
  const feeFailure = $derived(list.failure);

  let permissions = $state<readonly string[] | null>(null);
  let reportOpen = $state(false);
  /* Bumped after a write, so the section re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  /*
   * The matter header's create control is this section's only create button: it answers the
   * press by opening the ledger's own record window (create-action.svelte.ts). The ledger is off
   * screen while a read has failed or on a sample matter, and the control says so instead of
   * pressing into nothing.
   */
  let ledger = $state<ReturnType<typeof FeeLedger> | null>(null);
  claimMatterCreate("fees", () => ({
    title: "Record a flat charge for professional services on this matter. It saves as a draft.",
    refusal: isSample
      ? SAMPLE_MATTER_REFUSAL
      : ledger === null
        ? "The ledger is not on screen, so nothing can be recorded from it."
        : undefined,
    run: () => ledger?.openNew(),
  }));

  $effect(() => {
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") permissions = outcome.value.permissions;
    })();
  });

  $effect(() => {
    const matterId = matter.id;
    const token = reloadToken;
    const subject = `${matterId}:${String(token)}`;
    if (billing.showing(subject)) return;
    if (isSample) {
      billing.settleEmpty(subject);
      return;
    }
    void billing.load(fetch, matterId, subject);
  });

  $effect(() => {
    const matterId = matter.id;
    const subject = `${matterId}:${String(reloadToken)}`;
    if (list.showing(subject)) return;
    list.reset(subject);
    if (isSample) {
      list.settleEmpty();
      return;
    }
    void list.load((cursor) => listMatterFeeLedger(fetch, matterId, cursor));
  });

  function loadMore(): void {
    void list.loadMore((cursor) => listMatterFeeLedger(fetch, matter.id, cursor));
  }

  /* The currency the matter's own bills are written in; the firm's default until one is read. */
  const currency = $derived(rows?.[0]?.summary.currency ?? "USD");

</script>

<!-- The next page is asked for on the surface's line directly above the counts strip, and the line
     exists only while there is a next page: the surface draws the band whenever it is handed the
     snippet, so the page hands it over only then. -->
{#snippet beneath()}
  <div class="flex flex-col items-start gap-8">
    <Button variant="secondary" onclick={loadMore} disabled={list.loadingMore}>
      {list.loadingMore ? "Loading" : "Load more fees"}
    </Button>
    <p class="text-xs text-text-muted">
      Showing the {(fees ?? []).length} most recent by service date. The totals below cover only these until you load more.
    </p>
  </div>
{/snippet}

<svelte:head>
  <title>Fees · {matter.title} · Magna Carta</title>
</svelte:head>

{#if feeFailure !== null}
  <FailureScreen
    failure={feeFailure}
    scale="screen"
    subject="The fees"
    fallback={list.failureMessage ?? undefined}
    reassurance="The record itself is unaffected: nothing was changed by this failure, and every
      recorded fee is still on the firm's record."
    onRetry={() => (reloadToken += 1)}
    onReport={() => (reportOpen = true)}
  />
  <ReportDialog
    bind:open={reportOpen}
    errorId={list.failureErrorId}
    route={feeFailure.request}
  />
{:else if failure !== null}
  <FailureScreen
    failure={failure.failure}
    scale="screen"
    subject="The fees"
    fallback={failure.whenSilent}
    reassurance="Nothing was changed. The agreement and recorded fees are still on record."
    onRetry={() => (reloadToken += 1)}
    onReport={() => (reportOpen = true)}
  />
  <ReportDialog
    bind:open={reportOpen}
    errorId={failure.failure.problem?.errorId ?? null}
    route={failure.failure.request}
  />
{:else if isSample}
  <section class="flex flex-col gap-16">
    <Alert.Root variant="info">
      <Alert.Title>This is a sample matter.</Alert.Title>
      <Alert.Description>
        This is a sample matter for previewing screens. It has no agreement or fees. Open one of the firm's matters to use it.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <FeeLedger
    bind:this={ledger}
    fees={fees ?? []}
    openFeeId={entryFromUrl()}
    loading={fees === null}
    matterId={matter.id}
    matterTitle={matter.title}
    matterNumber={matter.matterNumber}
    {currency}
    {permissions}
    onChanged={() => (reloadToken += 1)}
    beneath={list.nextCursor !== null ? beneath : undefined}
  />
{/if}

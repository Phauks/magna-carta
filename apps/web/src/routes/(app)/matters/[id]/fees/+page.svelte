<script lang="ts">
  /*
   * The matter's Fees section: the work-in-progress fee ledger and the fee agreement, at the same
   * level as Time and Costs. A fee is a flat charge for professional services — its own dated draft
   * with a timekeeper, a description, an amount and a billing disposition — and it reaches a bill
   * the same way a cost does: a draft invoice claims it. Bills themselves live in Billing.
   *
   * The arrangement read rides the same billing state the Billing section reads, so the two
   * sections cannot disagree about what the matter's fee agreement says.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import { readSession } from "$lib/matters/matters-api.ts";
  import FailureScreen from "$lib/diagnostics/failure-screen.svelte";
  import ReportDialog from "$lib/diagnostics/report-dialog.svelte";
  import FeeLedger from "$lib/billing/fee-ledger.svelte";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import { MatterBilling } from "$lib/billing/matter-billing.svelte.ts";
  import type { FeeRecord } from "$lib/billing/fee-record.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const billing = new MatterBilling();
  const rows = $derived(billing.rows);
  const failure = $derived(billing.failure);

  let permissions = $state<readonly string[] | null>(null);
  let reportOpen = $state(false);
  /* Bumped after a write, so the section re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

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

  /* The currency the matter's own bills are written in; the firm's default until one is read. */
  const currency = $derived(rows?.[0]?.summary.currency ?? "USD");

  /*
   * The matter's fees. A fee is a first-class work-in-progress record, and no route serves one
   * yet. The ledger is therefore handed an empty set and says on the screen what it is waiting
   * for, rather than being handed the matter's invoice LINES, which is what a bill does to a fee
   * and not what a fee is.
   */
  const fees: readonly FeeRecord[] = [];
</script>

<svelte:head>
  <title>Fees · {matter.title} · Magna Carta</title>
</svelte:head>

{#if failure !== null}
  <FailureScreen
    failure={failure.failure}
    scale="screen"
    subject="The fees"
    fallback={failure.whenSilent}
    reassurance="The record itself is unaffected: nothing was changed by this failure, and the
      agreement and every recorded fee are still on the firm's record."
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
        It exists so the matter screens stay reviewable at a stable address; there is no firm record
        behind it, so it has no fee agreement and nothing can be charged against it. Open one of the
        firm's own matters to use this surface.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <FullHeightSection>
    <FeeLedger
      {fees}
      arrangement={billing.arrangement}
      loading={rows === null}
      matterId={matter.id}
      matterTitle={matter.title}
      matterNumber={matter.matterNumber}
      {currency}
      {permissions}
      onAmended={() => (reloadToken += 1)}
    />
  </FullHeightSection>
{/if}

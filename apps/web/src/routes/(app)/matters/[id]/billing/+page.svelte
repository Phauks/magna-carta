<script lang="ts">
  /*
   * The matter's Billing section: its bills, and the agreement they are composed under.
   *
   * TWO SURFACES, ONE SECTION, IN CAUSE-AND-EFFECT ORDER. FEES is the agreement — what this matter
   * charges — and the charge ledger it has produced. BILLS is the register of the documents the
   * client has actually been given. They are the same subject at two altitudes, so they are two
   * tabs of one section rather than two places to go looking.
   *
   * THE PAGE IS THE READ AND THE STATE SET; the surfaces below it are the screens. A SAMPLE matter
   * (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no firm behind it
   * and therefore no bills to read: it says so rather than showing an empty register, because "no
   * bills yet" and "not a real matter" are different facts.
   *
   * A FAILED READ KEEPS ITS EVIDENCE. The failing request, the answer, the moment and the
   * correlation handle are held rather than collapsed into one sentence, because they are what a
   * person needs to report the failure.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import { readSession } from "$lib/matters/matters-api.ts";
  import BillRegister from "$lib/billing/bill-register.svelte";
  import BillingErrorState from "$lib/billing/billing-error-state.svelte";
  import BillingProblemReportDialog from "$lib/billing/billing-problem-report-dialog.svelte";
  import FeeLedger from "$lib/billing/fee-ledger.svelte";
  import { MatterBilling } from "$lib/billing/matter-billing.svelte.ts";
  import { feeCharges } from "$lib/billing/fee-charges.ts";
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
  let openTab = $state("bills");

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

  /*
   * The client's name as the register states it. The matter's own record names the client for
   * reading; the party record names the entity that is billed. Where they disagree the matter's
   * spelling is what a reader knows the client by, so it leads.
   */
  const clientName = $derived(
    matter.clientDisplayName ?? billing.clientName ?? "This matter's client",
  );

  /* The currency the matter's own bills are written in; the firm's default until one is read. */
  const currency = $derived(rows?.[0]?.summary.currency ?? "USD");

  const charges = $derived(
    feeCharges(rows ?? [], matter.id, billing.arrangement?.history ?? []),
  );

  const unbilledFeeMinor = $derived(billing.unbilled?.timeAmountMinor ?? 0);

  function showBill(invoiceId: string): void {
    openTab = "bills";
    selectedBillIdentifier = invoiceId;
  }

  /* Which bill the register should show when the fee ledger sends a reader to it. */
  let selectedBillIdentifier = $state<string | null>(null);
</script>

<svelte:head>
  <title>Billing · {matter.title} · Magna Carta</title>
</svelte:head>

{#if failure !== null}
  <BillingErrorState
    title="Billing Could Not Be Read"
    detail={failure.detail}
    request={failure.request}
    status={failure.status}
    errorId={failure.errorId}
    failedAt={failure.failedAt}
    onRetry={() => (reloadToken += 1)}
    onReport={() => (reportOpen = true)}
  />
  <BillingProblemReportDialog
    bind:open={reportOpen}
    errorId={failure.errorId}
    route={failure.request}
  />
{:else if isSample}
  <section class="flex flex-col gap-16">
    <Alert.Root variant="info">
      <Alert.Title>This is a sample matter.</Alert.Title>
      <Alert.Description>
        It exists so the matter screens stay reviewable at a stable address; there is no firm record
        behind it, so it has no fee agreement and no bills, and nothing can be billed against it.
        Open one of the firm's own matters to use this surface.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <div class="flex min-h-0 flex-1 flex-col gap-12">
    {#if billing.clientEntityId === null && rows !== null}
      <Alert.Root variant="warning">
        <Alert.Title>This Matter Names No Client</Alert.Title>
        <Alert.Description>
          A bill belongs to a client, and this matter's party record does not name one yet. The
          agreement can still be recorded; nothing can be billed until a party wearing the client
          role is linked on the Parties tab.
        </Alert.Description>
      </Alert.Root>
    {/if}

    <Tabs.Root bind:value={openTab} class="flex min-h-0 flex-1 flex-col gap-12">
      <Tabs.List class="self-start">
        <Tabs.Trigger value="bills">Bills</Tabs.Trigger>
        <Tabs.Trigger value="fees">Fees</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="bills" class="flex min-h-0 flex-1 flex-col">
        <BillRegister
          rows={rows ?? []}
          loading={rows === null}
          matterId={matter.id}
          matterNumber={matter.matterNumber}
          clientEntityId={billing.clientEntityId}
          {clientName}
          {currency}
          unbilled={billing.unbilled}
          unbilledTime={billing.unbilledTime}
          unbilledCosts={billing.unbilledCosts}
          clientCredits={billing.clientCredits}
          {permissions}
          selectBill={selectedBillIdentifier}
          onSelectionHandled={() => (selectedBillIdentifier = null)}
          onChanged={() => (reloadToken += 1)}
        />
      </Tabs.Content>

      <Tabs.Content value="fees" class="flex min-h-0 flex-1 flex-col">
        <FeeLedger
          {charges}
          rows={rows ?? []}
          arrangement={billing.arrangement}
          unbilledMinor={unbilledFeeMinor}
          loading={rows === null}
          matterId={matter.id}
          matterTitle={matter.title}
          matterNumber={matter.matterNumber}
          {currency}
          {permissions}
          onShowBill={showBill}
          onAmended={() => (reloadToken += 1)}
        />
      </Tabs.Content>
    </Tabs.Root>

    {#if billing.nextCursor !== null}
      <p class="text-xs text-text-muted">
        This client has more bills than are read here: the register is showing the {(rows ?? []).length}
        most recent, and the figures beneath it cover only those. Reading the whole history is a
        further page this section does not ask for yet.
      </p>
    {/if}
  </div>
{/if}

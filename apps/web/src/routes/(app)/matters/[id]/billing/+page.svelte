<script lang="ts">
  /*
   * The matter's Billing section: the register of the bills the client has actually been given,
   * and the window each of them opens in. The work-in-progress fee ledger lives in its own Fees
   * section at the same level as Time and Costs; a fee reaches a bill the same way a cost does —
   * a draft invoice claims it.
   *
   * THE REGISTER IS THIS MATTER'S OWN. The listing is asked for this matter, so the rows are the
   * bills that charge it — drafts included — each carrying this matter's share rather than the
   * document's whole total. It used to be the CLIENT's bills, with the share reached by reading
   * every one of their details, which stated the client's account under the matter's heading.
   *
   * THE PAGE IS THE READ AND THE STATE SET; the surfaces below it are the screens. The register
   * renders inside the money surface, which takes the rest of the screen and keeps it; the page
   * hands it the rows, the client, and the one line about bills not read here. A SAMPLE matter
   * (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no firm behind it
   * and therefore no bills to read: it says so rather than showing an empty register, because "no
   * bills yet" and "not a real matter" are different facts.
   *
   * A FAILED READ KEEPS ITS EVIDENCE. The failing request, the answer, the moment and the
   * correlation handle are held rather than collapsed into one sentence, because they are what a
   * person needs to report the failure.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import BillRegister from "$lib/billing/bill-register.svelte";
  import FailureScreen from "$lib/diagnostics/failure-screen.svelte";
  import ReportDialog from "$lib/diagnostics/report-dialog.svelte";
  import { MatterBilling } from "$lib/billing/matter-billing.svelte.ts";
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

  /*
   * The matter header's create control is this section's only create button: it answers the
   * press by opening the ledger's own record window (create-action.svelte.ts). The ledger is off
   * screen while a read has failed or on a sample matter, and the control says so instead of
   * pressing into nothing.
   */
  let ledger = $state<ReturnType<typeof BillRegister> | null>(null);
  claimMatterCreate("billing", () => ({
    title: "Open a draft bill for this matter's client. Nothing is asserted to anybody until it is finalized.",
    refusal: isSample
      ? SAMPLE_MATTER_REFUSAL
      : rows !== null && billing.clientEntityId === null
        ? "This matter's party record names no client, so there is nobody to bill."
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
</script>

<svelte:head>
  <title>Billing · {matter.title} · Magna Carta</title>
</svelte:head>

<!-- Passed only while there is a further page, so the surface never draws an empty ruled line
     above the counts strip on a register that is complete. -->
{#snippet beneath()}
  <p class="text-xs text-text-muted">
    This matter has more bills than are read here: the register is showing the {(rows ?? []).length}
    most recent, and the figures beneath it cover only those. Reading the whole history is a
    further page this section does not ask for yet.
  </p>
{/snippet}

{#if failure !== null}
  <FailureScreen
    failure={failure.failure}
    scale="screen"
    subject="Billing"
    fallback={failure.whenSilent}
    reassurance="The record itself is unaffected: nothing was changed by this failure, and the
      agreement and every finalized bill are still on the firm's record."
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
        behind it, so it has no fee agreement and no bills, and nothing can be billed against it.
        Open one of the firm's own matters to use this surface.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <!-- The register warns about a matter that names no client itself, first in its notices band;
       the page's part is the read and the line beneath the list about bills not read here. -->
  <BillRegister
    bind:this={ledger}
    rows={rows ?? []}
    loading={rows === null}
    matterId={matter.id}
    matterTitle={matter.title}
    matterNumber={matter.matterNumber}
    clientEntityId={billing.clientEntityId}
    {clientName}
    {currency}
    unbilled={billing.unbilled}
    unbilledTime={billing.unbilledTime}
    unbilledCosts={billing.unbilledCosts}
    clientCredits={billing.clientCredits}
    {permissions}
    onChanged={() => (reloadToken += 1)}
    beneath={billing.nextCursor !== null ? beneath : undefined}
  />
{/if}

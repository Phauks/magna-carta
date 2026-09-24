<script lang="ts">
  /*
   * The matter's Trust section: the ledger of client money held for this matter, at the same
   * level as Time, Fees, Costs and Billing. A movement is a deposit into the matter's trust
   * ledger, a disbursement out of it, or a transfer between two of this client's matters, and
   * fees never touch it until they are earned and applied from Billing.
   *
   * THE PAGE IS THE READ AND THE STATE SET; the surfaces below it are the screens. Everything the
   * section reads is in one store (matter-trust.svelte.ts), because the reads depend on each other:
   * the firm's trust accounts decide which account this matter's ledger is read against, and that
   * account decides both the ledger and the queue of payments waiting on somebody's decision.
   *
   * THREE THINGS THAT LOOK LIKE AN EMPTY LEDGER ARE NOT THE SAME FACT, and the section says which
   * one it is. A firm that has opened no trust account has nowhere to hold client money. A matter
   * that has never received any holds no ledger leaf yet — it is created by the first deposit. And
   * a read that failed is a failure, with its evidence kept. A SAMPLE matter (the in-repo fixtures
   * the chrome's lifecycle states are reviewed against) is a fourth: it has no firm behind it, so
   * it holds no client money and says so rather than showing an empty register.
   *
   * A FAILED READ KEEPS ITS EVIDENCE. The failing request, the answer, the moment and the
   * correlation handle are held rather than collapsed into one sentence, because they are what a
   * person needs to report the failure.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import FailureScreen from "$lib/diagnostics/failure-screen.svelte";
  import ReportDialog from "$lib/diagnostics/report-dialog.svelte";
  import TrustLedger from "$lib/trust/trust-ledger.svelte";
  import { MatterTrust } from "$lib/trust/matter-trust.svelte.ts";
  import { TRUST_PERMISSIONS } from "$lib/trust/trust-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const trust = new MatterTrust();
  const failure = $derived(trust.failure);

  let permissions = $state<readonly string[] | null>(null);
  let sessionUserId = $state<string | null>(null);
  let reportOpen = $state(false);
  /* Bumped after a write, so the section re-reads what the server now holds rather than guessing. */
  let reloadToken = $state(0);

  /*
   * The matter header's create control is this section's only create button. It reads New Deposit
   * from the registry and answers the press through the ledger (create-action.svelte.ts). The
   * refusals are in the order a reader meets them: a matter nothing can be recorded against, a
   * session not yet read, an account that may not move client money, a firm with no trust account,
   * and a roster that did not load.
   */
  let surface = $state<ReturnType<typeof TrustLedger> | null>(null);
  claimMatterCreate("trust", () => ({
    title: "Record client money received into this matter's trust ledger.",
    refusal: isSample
      ? SAMPLE_MATTER_REFUSAL
      : permissions === null
        ? "Reading your session."
        : !permissions.includes(TRUST_PERMISSIONS.manage)
          ? permissionRefusal("Recording a deposit", TRUST_PERMISSIONS.manage)
          : failure !== null
            ? "The firm's trust accounts did not load, so there is no account to pay this into."
            : trust.accountsRead && trust.account === null
              ? "The firm has not opened a trust account yet, so there is nowhere to pay this in."
              : undefined,
    run: () => surface?.openNew(),
  }));

  $effect(() => {
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") {
        permissions = outcome.value.permissions;
        sessionUserId = outcome.value.user.id;
      }
    })();
  });

  $effect(() => {
    const matterId = matter.id;
    const token = reloadToken;
    const subject = `${matterId}:${String(token)}`;
    if (trust.showing(subject)) return;
    if (isSample) {
      trust.settleEmpty(subject);
      return;
    }
    void trust.load(fetch, matterId, subject);
  });
</script>

<svelte:head>
  <title>Trust · {matter.title} · Magna Carta</title>
</svelte:head>

{#if failure !== null}
  <FailureScreen
    failure={failure.failure}
    scale="screen"
    subject="Trust"
    fallback={failure.whenSilent}
    reassurance="The record itself is unaffected: nothing was changed by this failure, and every
      movement of this client's money is still on the firm's record."
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
        behind it, so it holds no client money and nothing can be moved against it. Open one of the
        firm's own matters to use this surface.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <TrustLedger
    bind:this={surface}
    movements={trust.movements ?? []}
    ledger={trust.ledger}
    loading={trust.movements === null}
    matterId={matter.id}
    matterTitle={matter.title}
    matterNumber={matter.matterNumber}
    accounts={trust.accounts}
    accountsCapped={trust.accountsCapped}
    account={trust.account}
    noLedgerYet={trust.noLedgerYet}
    pendingRequests={trust.pendingRequests}
    pendingRefusal={trust.pendingRefusal}
    {permissions}
    {sessionUserId}
    onChooseAccount={(accountId) => void trust.choose(accountId)}
    onChanged={() => (reloadToken += 1)}
  />
{/if}

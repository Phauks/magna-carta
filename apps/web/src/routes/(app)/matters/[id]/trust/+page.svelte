<script lang="ts">
  /*
   * The matter's Trust section: the ledger of client money held for this matter, at the same
   * level as Time, Fees, Costs and Billing. A movement is a deposit into the matter's trust
   * ledger, a disbursement out of it, or a transfer between two of this client's matters, and
   * fees never touch it until they are earned and applied from Billing.
   *
   * NO READ RUNS YET. The matter's ledger is read against one of the firm's trust accounts, and
   * nothing lists them (trust-gaps.ts, `account`), so the ledger is handed no movements and no
   * position and says on the screen what it waits on. The read, its failure screen and its retry
   * arrive with the account listing; that is also why this page has no FailureScreen branch.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import { soonDependencySentence } from "@magna-carta/design-system/maturity";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import TrustLedger from "$lib/trust/trust-ledger.svelte";
  import { gapReason } from "$lib/trust/trust-gaps.ts";
  import type { TrustMovementRecord } from "$lib/trust/trust-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  /*
   * The matter header's create control is this section's only create button. It reads New Deposit
   * from the registry and answers the press through the ledger (create-action.svelte.ts); until
   * the firm's trust accounts can be read there is no account to post into, so the control stands
   * refused with that line rather than pressing into nothing.
   */
  let surface = $state<ReturnType<typeof TrustLedger> | null>(null);
  claimMatterCreate("trust", () => ({
    title: "Record a deposit into this matter's trust ledger.",
    refusal: isSample ? SAMPLE_MATTER_REFUSAL : soonDependencySentence(gapReason("account")),
    run: () => surface?.openNew(),
  }));

  /*
   * The matter's movements. The ledger read takes a trust account and nothing can name one yet,
   * so the ledger is handed an empty record and no position rather than a guess at either.
   */
  const movements: readonly TrustMovementRecord[] = [];
</script>

<svelte:head>
  <title>Trust · {matter.title} · Magna Carta</title>
</svelte:head>

{#if isSample}
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
    {movements}
    ledger={null}
    loading={false}
    matterId={matter.id}
    matterTitle={matter.title}
    matterNumber={matter.matterNumber}
  />
{/if}

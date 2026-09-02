<script lang="ts">
  /*
   * Withdrawing a cost.
   *
   * This is the one irreversible-feeling act on the ledger, so it is a confirmation rather than a
   * click, and it is done one cost at a time. What the dialog has to make unmissable is that
   * nothing is deleted: the cost freezes, stops counting toward every total, and stays on the
   * record as evidence of what was withdrawn. A withdrawn cost was never advanced.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import type { CostLedgerEntry } from "./cost-operations.ts";
  import { voidCost, writeKey } from "./cost-operations.ts";
  import { payeeText } from "./cost-vocabulary.ts";

  let {
    open = $bindable(false),
    cost,
    currency,
    onVoided,
  }: {
    open?: boolean;
    cost: CostLedgerEntry | null;
    currency: string;
    onVoided: () => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    failure = null;
  }

  const identity = $derived(
    cost === null
      ? ""
      : `${formatDate(cost.incurredDate)} · ${payeeText(cost)} · ${formatMoney(cost.amountMinor / 100, { currency })}`,
  );

  async function withdraw(): Promise<ActionOutcome> {
    if (cost === null) return "refused";
    failure = null;
    const outcome = await voidCost(fetch, cost.id, writeKey());
    if (outcome.kind === "ok") {
      onVoided();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The cost was not voided.",
      "The cost was not voided and is unchanged.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Void Cost"
  commitLabel="Void Cost"
  commitBusyLabel="Voiding"
  commitRefusal={cost === null ? "No cost is open." : undefined}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={withdraw}
>
  {#snippet subtitle()}{identity}{/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields()}
    <p class="text-sm">
      The cost freezes and stops counting toward the matter&rsquo;s totals: a withdrawn cost was
      never advanced. It stays on the record, struck through, with everything it recorded. Nothing
      is deleted.
    </p>
  {/snippet}
</ActionDialog>

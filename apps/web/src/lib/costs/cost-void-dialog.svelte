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
  import * as AlertDialog from "@magna-carta/design-system/alert-dialog";
  import { buttonClasses } from "@magna-carta/design-system/button";
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

  let sending = $state(false);
  let failure = $state<string | null>(null);

  $effect(() => {
    const subject = cost?.id ?? null;
    if (subject === null) return;
    failure = null;
  });

  const identity = $derived(
    cost === null
      ? ""
      : `${formatDate(cost.incurredDate)} · ${payeeText(cost)} · ${formatMoney(cost.amountMinor / 100, { currency })}`,
  );

  async function withdraw(): Promise<void> {
    if (cost === null || sending) return;
    sending = true;
    failure = null;
    const outcome = await voidCost(fetch, cost.id, writeKey());
    sending = false;
    if (outcome.kind === "ok") {
      open = false;
      onVoided();
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. The cost was not voided and is unchanged."
        : `${outcome.problem.detail ?? "The cost was not voided."}${
            outcome.problem.errorId === undefined ? "" : ` Error ID ${outcome.problem.errorId}.`
          }`;
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Title>Void Cost</AlertDialog.Title>
    <AlertDialog.Description>{identity}</AlertDialog.Description>

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Nothing Changed</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}

    <p class="text-sm">
      The cost freezes and stops counting toward the matter&rsquo;s totals: a withdrawn cost was
      never advanced. It stays on the record, struck through, with everything it recorded. Nothing
      is deleted.
    </p>

    <div class="flex justify-end gap-8">
      <AlertDialog.Cancel
        class={buttonClasses({ variant: "secondary", size: "default" })}
        disabled={sending}
      >
        Cancel
      </AlertDialog.Cancel>
      <!-- Bits' Action does not self-close: the write decides when the panel goes, so a refusal
           stays on screen with its reason rather than closing over it. -->
      <AlertDialog.Action
        class={buttonClasses({ variant: "destructive", size: "default" })}
        disabled={sending}
        title="Freeze this cost and take it out of every total"
        onclick={(event) => {
          event.preventDefault();
          void withdraw();
        }}
      >
        Void Cost
      </AlertDialog.Action>
    </div>
  </AlertDialog.Content>
</AlertDialog.Root>

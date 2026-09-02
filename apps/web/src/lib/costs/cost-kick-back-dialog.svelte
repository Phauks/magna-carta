<script lang="ts">
  /*
   * Returning a cost to the person who recorded it.
   *
   * THE REASON IS THE ACT. A kick-back with no reason is a rejection with no instruction in it: the
   * recorder is left to guess what to change, and the audit trail records that somebody was
   * unhappy rather than what was wrong. So the control refuses until a reason is written, and says
   * so before it is pressed rather than after.
   *
   * The cost returns to draft and becomes editable again. Nothing about it is removed.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import type { CostLedgerEntry } from "./cost-operations.ts";
  import { kickBackCost, writeKey } from "./cost-operations.ts";
  import { payeeText } from "./cost-vocabulary.ts";

  let {
    open = $bindable(false),
    cost,
    currency,
    onKickedBack,
  }: {
    open?: boolean;
    /** The cost being returned. Null closes the dialog's subject with it. */
    cost: CostLedgerEntry | null;
    currency: string;
    /** The cost is a draft again. The consumer re-reads the matter's costs. */
    onKickedBack: () => void;
  } = $props();

  const fieldPrefix = $props.id();

  let reason = $state("");
  let failure = $state<StatedFailure | null>(null);

  // A fresh opening is a fresh reason: reopening on another cost must never carry the last one's.
  function reset(): void {
    reason = "";
    failure = null;
  }

  const identity = $derived(
    cost === null
      ? ""
      : `${formatDate(cost.incurredDate)} · ${payeeText(cost)} · ${formatMoney(cost.amountMinor / 100, { currency })}`,
  );

  const refusal = $derived.by((): string | undefined => {
    if (cost === null) return "No cost is open.";
    if (reason.trim() === "") return "Enter the reason: it is recorded for the recorder to act on";
    return undefined;
  });

  async function send(): Promise<ActionOutcome> {
    if (cost === null) return "refused";
    failure = null;
    const outcome = await kickBackCost(fetch, cost.id, reason.trim(), writeKey());
    if (outcome.kind === "ok") {
      onKickedBack();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The cost was not returned.",
      "The cost was not returned and is unchanged.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Kick Back Cost"
  commitLabel="Kick Back"
  commitBusyLabel="Returning"
  commitRefusal={refusal}
  unsavedChanges={reason.trim() !== ""}
  onOpen={reset}
  onCommit={send}
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

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-8">
      <Label for="{fieldPrefix}-reason">Reason</Label>
      <Textarea
        id="{fieldPrefix}-reason"
        rows={3}
        placeholder={placeholderOf("Reason")}
        disabled={busy}
        bind:value={reason}
      />
      <p class="text-xs text-text-muted">
        Say what needs to change before this cost can be approved. The cost returns to the person
        who recorded it as a draft, and the reason is recorded on the audit trail.
      </p>
    </div>
  {/snippet}
</ActionDialog>

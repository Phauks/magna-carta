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
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
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
  let sending = $state(false);
  let failure = $state<StatedFailure | null>(null);

  // A fresh subject is a fresh reason: reopening on another cost must never carry the last one's.
  $effect(() => {
    const subject = cost?.id ?? null;
    if (subject === null) return;
    reason = "";
    failure = null;
  });

  const identity = $derived(
    cost === null
      ? ""
      : `${formatDate(cost.incurredDate)} · ${payeeText(cost)} · ${formatMoney(cost.amountMinor / 100, { currency })}`,
  );

  const refusal = $derived(
    reason.trim() === "" ? "Enter the reason: it is recorded for the recorder to act on" : null,
  );

  async function send(): Promise<void> {
    if (cost === null || refusal !== null || sending) return;
    sending = true;
    failure = null;
    const outcome = await kickBackCost(fetch, cost.id, reason.trim(), writeKey());
    sending = false;
    if (outcome.kind === "ok") {
      open = false;
      onKickedBack();
      return;
    }
    failure = stated(
      outcome.failure,
      "The cost was not returned.",
      "The cost was not returned and is unchanged.",
    );
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Kick Back Cost</Dialog.Title>
    <Dialog.Description>{identity}</Dialog.Description>

    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}

    <div class="flex flex-col gap-8">
      <Label for="{fieldPrefix}-reason">Reason</Label>
      <Textarea
        id="{fieldPrefix}-reason"
        rows={3}
        placeholder={placeholderOf("Reason")}
        disabled={sending}
        bind:value={reason}
      />
      <p class="text-xs text-text-muted">
        Say what needs to change before this cost can be approved. The cost returns to the person
        who recorded it as a draft, and the reason is recorded on the audit trail.
      </p>
    </div>

    <div class="flex justify-end gap-8">
      <Button variant="secondary" disabled={sending} onclick={() => (open = false)}>Cancel</Button>
      <Button
        disabled={refusal !== null || sending}
        title={refusal ?? "Return the cost to draft with this reason"}
        onclick={() => void send()}
      >
        Kick Back
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

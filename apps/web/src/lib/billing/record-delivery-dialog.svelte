<script lang="ts">
  /*
   * Recording that a bill reached the client.
   *
   * THE PLATFORM SENDS NOTHING. Every channel here is a delivery the FIRM made and is telling the
   * platform about. That is the single most important sentence on this dialog, and it sits above the
   * fields rather than under the control, because somebody who reads it afterwards has already
   * pressed a button they thought would send an email.
   *
   * A FAILURE IS RECORDED, NOT LEFT OUT. A returned letter or a rejected submission is an attempt,
   * and a history that holds only successes reads as complete when it is not.
   *
   * THE DATE IS THE FIRM'S TO STATE AND IS USUALLY NOT TODAY. A bill posted last Tuesday and
   * recorded this morning carries last Tuesday's date, which is why the field is a date and not a
   * timestamp the platform takes.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import {
    billingFailure,
    recordInvoiceDelivery,
    DELIVERY_CHANNELS,
    DELIVERY_CHANNEL_LABELS,
    type DeliveryChannel,
    type DeliveryOutcome,
  } from "./billing-api.ts";
  import { civilToday, type InvoiceRow } from "./invoice-standing.ts";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";

  let {
    open = $bindable(false),
    row,
    onRecorded,
  }: {
    open?: boolean;
    row: InvoiceRow | null;
    onRecorded: () => void;
  } = $props();

  const fieldPrefix = $props.id();

  const CHANNEL_ITEMS = DELIVERY_CHANNELS.map((channel) => ({
    value: channel,
    label: DELIVERY_CHANNEL_LABELS[channel],
  }));
  const OUTCOME_ITEMS: readonly { value: DeliveryOutcome; label: string }[] = [
    { value: "delivered", label: "Delivered" },
    { value: "failed", label: "Failed: bounced, returned, or rejected" },
  ];

  // The Select works in plain strings; the closed unions are restored on the way out, where a value
  // the control cannot produce falls back to the field's own default rather than reaching the wire.
  let channel = $state<string>("email");
  let recipient = $state("");
  let deliveryDate = $state(civilToday());
  let outcome = $state<string>("delivered");
  let externalReference = $state("");
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    channel = "email";
    recipient = "";
    deliveryDate = civilToday();
    outcome = "delivered";
    externalReference = "";
    failure = null;
  }

  function chosenChannel(): DeliveryChannel {
    return DELIVERY_CHANNELS.find((candidate) => candidate === channel) ?? "email";
  }

  /*
   * The bill being acted on, by its own number. The facts beside it are facts about THAT BILL — what
   * it still owes, what it is worth — never a description of the act, which the heading has already
   * given. Both were in one interpolated string before, which is how a number and a sentence came to
   * share a line behind three different separators across these panels.
   */
  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Bill", number: row?.summary.invoiceNumber ?? null },
  });

  const refusal = $derived.by((): string | undefined => {
    if (recipient.trim() === "") return "Say who received it: the address, mailbox, or person.";
    if (deliveryDate === "") return "Say when it reached them.";
    return undefined;
  });

  async function record(): Promise<ActionOutcome> {
    if (row === null) return "refused";
    failure = null;
    const result = await recordInvoiceDelivery(
      fetch,
      row.summary.id,
      {
        channel: chosenChannel(),
        recipientReference: recipient.trim(),
        deliveryDate,
        externalReference: externalReference.trim() === "" ? null : externalReference.trim(),
        outcome: outcome === "failed" ? "failed" : "delivered",
      },
      crypto.randomUUID(),
    );
    if (result.kind === "ok") {
      onRecorded();
      return "committed";
    }
    failure = billingFailure(result, "No delivery was recorded.");
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Record a Delivery"
  {subtitle}
  commitLabel="Record Delivery"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  unsavedChanges={recipient.trim() !== "" || externalReference.trim() !== ""}
  onOpen={reset}
  onCommit={record}
>

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Recorded"
        fallback={failure.fallback}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label id="{fieldPrefix}-channel-label">How It Went</Label>
          <Select.Root
            type="single"
            items={CHANNEL_ITEMS}
            bind:value={channel}
            allowDeselect={false}
            disabled={busy}
          >
            <Select.Trigger aria-labelledby="{fieldPrefix}-channel-label">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each CHANNEL_ITEMS as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-8">
          <DatePicker
            label="Date It Reached Them"
            value={civilDateValue(deliveryDate)}
            onValueChange={(next) => (deliveryDate = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-recipient">Recipient</Label>
        <Input id="{fieldPrefix}-recipient" disabled={busy} bind:value={recipient} />
        <p class="text-xs text-text-muted">
          Who received it: the postal address, the email address, or the person it was handed to.
        </p>
      </div>

      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label id="{fieldPrefix}-outcome-label">What Became Of It</Label>
          <Select.Root
            type="single"
            items={[...OUTCOME_ITEMS]}
            bind:value={outcome}
            allowDeselect={false}
            disabled={busy}
          >
            <Select.Trigger aria-labelledby="{fieldPrefix}-outcome-label">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each OUTCOME_ITEMS as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-reference">Carrier Reference</Label>
          <Input id="{fieldPrefix}-reference" disabled={busy} bind:value={externalReference} />
          <p class="text-xs text-text-muted">
            A tracking number or other reference, if there is one.
          </p>
        </div>
      </div>

      <p class="text-xs text-text-subtle">
        Each attempt is recorded separately, so a bill sent twice has two records. Deliveries are shown when taking fees from trust but don't block it.
      </p>
    </div>
  {/snippet}
</ActionDialog>

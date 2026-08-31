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
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Send from "@lucide/svelte/icons/send";
  import {
    billingFailureText,
    recordInvoiceDelivery,
    DELIVERY_CHANNELS,
    DELIVERY_CHANNEL_LABELS,
    type DeliveryChannel,
    type DeliveryOutcome,
  } from "./billing-api.ts";
  import { civilToday, type InvoiceRow } from "./invoice-standing.ts";

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
  let working = $state(false);
  let failure = $state<string | null>(null);

  $effect(() => {
    if (!open) return;
    channel = "email";
    recipient = "";
    deliveryDate = civilToday();
    outcome = "delivered";
    externalReference = "";
    failure = null;
  });

  function chosenChannel(): DeliveryChannel {
    return DELIVERY_CHANNELS.find((candidate) => candidate === channel) ?? "email";
  }

  const refusal = $derived.by((): string | null => {
    if (recipient.trim() === "") return "Say who received it: the address, mailbox, or person.";
    if (deliveryDate === "") return "Say when it reached them.";
    return null;
  });

  async function record(): Promise<void> {
    if (row === null || working || refusal !== null) return;
    working = true;
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
    working = false;
    if (result.kind === "ok") {
      open = false;
      onRecorded();
      return;
    }
    failure = billingFailureText(result, "No delivery was recorded.");
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Record a Delivery</Dialog.Title>
    <Dialog.Description>
      {row?.summary.invoiceNumber ?? "This bill"} · records a delivery the firm made; nothing is sent
    </Dialog.Description>

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Nothing Was Recorded</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="flex flex-col gap-16">
      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label id="{fieldPrefix}-channel-label">How It Went</Label>
          <Select.Root
            type="single"
            items={CHANNEL_ITEMS}
            bind:value={channel}
            allowDeselect={false}
            disabled={working}
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
          <Label for="{fieldPrefix}-date">Date It Reached Them</Label>
          <Input
            id="{fieldPrefix}-date"
            type="date"
            disabled={working}
            bind:value={deliveryDate}
          />
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-recipient">Recipient</Label>
        <Input
          id="{fieldPrefix}-recipient"
          disabled={working}
          bind:value={recipient}
        />
        <p class="text-xs text-text-muted">
          Who received it, in the firm's own words: the address it was posted to, the mailbox it was
          emailed to, or the person it was handed to.
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
            disabled={working}
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
          <Input
            id="{fieldPrefix}-reference"
            disabled={working}
            bind:value={externalReference}
          />
          <p class="text-xs text-text-muted">
            The handle of whatever carried it, where something did: a tracking number, a gateway
            submission reference, the message id of a mail sent elsewhere.
          </p>
        </div>
      </div>

      <p class="text-xs text-text-subtle">
        Each attempt is its own permanent record: a bill sent twice has two, and a returned letter
        followed by a successful re-send reads as exactly that.
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <span class="mr-auto max-w-sm text-xs text-text-subtle">
        Shown beside the decision to take fees from trust; it gates nothing.
      </span>
      <Button variant="secondary" disabled={working} onclick={() => (open = false)}>Cancel</Button>
      <Button
        disabled={working || refusal !== null}
        title={refusal ?? "Record this delivery"}
        onclick={() => void record()}
      >
        <Send class="size-16" aria-hidden="true" />
        {working ? "Recording" : "Record Delivery"}
      </Button>
    </div>
    {#if refusal !== null}
      <p class="text-right text-xs text-text-muted">{refusal}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>

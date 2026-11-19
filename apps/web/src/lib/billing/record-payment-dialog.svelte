<script lang="ts">
  /*
   * Recording a payment the firm received by hand: a check, cash, a bank transfer, or a card run on
   * the firm's own terminal. The money is already in the operating account; this puts it on the
   * books and brings the bill down by the same amount.
   *
   * IT CANNOT EXCEED WHAT THE MATTER STILL OWES. An over-payment has nowhere to land yet, so the
   * ceiling is shown and filled in rather than discovered when the server refuses.
   *
   * A TRUST DEPOSIT IS NOT A PAYMENT. Money the client sends to be held is deposited on their trust
   * ledger and reaches the bill later through Apply Trust Funds, so the dialog says so before
   * anything is typed.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Info from "@lucide/svelte/icons/info";
  import { billingFailure, recordPayment, type PaymentMethod } from "./billing-api.ts";
  import { amountFieldText, readBoundedAmountMinor } from "./amount-entry.ts";
  import { civilToday, matterUnpaidMinor, type InvoiceRow } from "./invoice-standing.ts";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";

  let {
    open = $bindable(false),
    row,
    matterId,
    money,
    onRecorded,
  }: {
    open?: boolean;
    row: InvoiceRow | null;
    matterId: string;
    money: (amountMinor: number) => string;
    onRecorded: (amountMinor: number) => void;
  } = $props();

  const fieldPrefix = $props.id();

  const CHECK = { value: "check", label: "Check", reference: "Check Number" } as const;
  const METHOD_ITEMS: readonly { value: PaymentMethod; label: string; reference: string }[] = [
    CHECK,
    { value: "bank_transfer", label: "Bank Transfer", reference: "Confirmation Number" },
    { value: "cash", label: "Cash", reference: "Receipt Number" },
    { value: "card_terminal", label: "Card", reference: "Approval Code" },
  ];

  const ceiling = $derived(row === null ? 0 : (matterUnpaidMinor(row, matterId) ?? 0));

  let amountText = $state("");
  let method = $state<string>("check");
  let reference = $state("");
  let effectiveDate = $state(civilToday());
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    amountText = amountFieldText(ceiling);
    method = "check";
    reference = "";
    effectiveDate = civilToday();
    failure = null;
  }

  // The Select works in plain strings; the closed union is restored on the way out.
  const chosen = $derived(METHOD_ITEMS.find((item) => item.value === method) ?? CHECK);

  const started = $derived(reference.trim() !== "" || amountText !== amountFieldText(ceiling));

  const reading = $derived(readBoundedAmountMinor(amountText, ceiling, money(ceiling)));

  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Bill", number: row?.summary.invoiceNumber ?? null },
    facts: [`this matter still owes ${money(ceiling)}`],
  });

  const refusal = $derived.by((): string | undefined => {
    if (row === null) return "No bill is open.";
    if (reading.kind === "empty") return "Say how much was paid.";
    if (reading.kind === "refused") return reading.reason;
    if (effectiveDate === "") return "Say when the payment arrived.";
    return undefined;
  });

  async function record(): Promise<ActionOutcome> {
    if (row === null || reading.kind !== "amount") return "refused";
    failure = null;
    const outcome = await recordPayment(
      fetch,
      row.summary.id,
      {
        matterId,
        amountMinor: reading.minor,
        method: chosen.value,
        reference: reference.trim() === "" ? null : reference.trim(),
        effectiveDate,
      },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onRecorded(reading.minor);
      return "committed";
    }
    failure = billingFailure(outcome, "The balance is unchanged.");
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Record a Payment"
  {subtitle}
  commitLabel="Record Payment"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  unsavedChanges={started}
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
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          For money the firm has already received into its operating account. Money to hold in trust is a trust deposit; apply it to this bill afterwards with Apply Trust Funds.
        </span>
      </p>

      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label necessity="required" for="{fieldPrefix}-amount">Amount</Label>
          <Input id="{fieldPrefix}-amount" disabled={busy} bind:value={amountText} />
        </div>
        <div class="flex flex-col gap-8">
          <DatePicker
            necessity="required"
            label="Date Received"
            value={civilDateValue(effectiveDate)}
            onValueChange={(next) => (effectiveDate = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
      </div>

      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label necessity="required" id="{fieldPrefix}-method-label">Method</Label>
          <Select.Root
            type="single"
            items={[...METHOD_ITEMS]}
            bind:value={method}
            allowDeselect={false}
            disabled={busy}
          >
            <Select.Trigger aria-labelledby="{fieldPrefix}-method-label">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each METHOD_ITEMS as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-8">
          <Label necessity="optional" for="{fieldPrefix}-reference">{chosen.reference}</Label>
          <Input id="{fieldPrefix}-reference" disabled={busy} bind:value={reference} />
        </div>
      </div>

      <p class="text-xs text-text-subtle">
        A payment can't be more than this matter still owes. To undo one recorded by mistake, reverse it; both records are kept.
      </p>
    </div>
  {/snippet}
</ActionDialog>

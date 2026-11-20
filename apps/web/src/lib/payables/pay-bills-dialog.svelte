<script lang="ts">
  /*
   * Pay Bills: the ticked bills, paid from one of the firm's own bank accounts.
   *
   * ANY OPERATING ACCOUNT CAN PAY, NEVER TRUST. The list offers every open operating account with
   * the default first; trust accounts are not in it at all, because client money never pays the
   * firm's bills, and the server refuses one by name if it ever arrives.
   *
   * ONE CHECK PAYS ONE VENDOR. With Check chosen and a first number given, each vendor's bills take
   * the next number in turn; left blank, the checks wait on the Checks screen to be printed.
   *
   * Each bill pays its open balance unless the amount is changed: a part payment is a smaller
   * figure, never more than is left.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { DatePicker, civilDateTextOrEmpty, civilDateValue } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import { todayInUtc } from "@magna-carta/civil-time/civil-date";
  import type { OperatingBankAccount, VendorBillSummary } from "@magna-carta/api-client";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import { payVendorBills } from "./payables-api.ts";
  import { money, parseAmountMinor } from "./vendor-bill-view.ts";

  type Method = "check" | "bank_transfer" | "card" | "cash";

  let {
    open = $bindable(false),
    bills,
    vendorNames,
    operatingAccounts,
    onPaid,
  }: {
    open?: boolean;
    /** The bills to pay, each with something left on it. */
    bills: readonly VendorBillSummary[];
    vendorNames: ReadonlyMap<string, string>;
    operatingAccounts: readonly OperatingBankAccount[];
    onPaid: () => void;
  } = $props();

  const openAccounts = $derived(
    operatingAccounts
      .filter((account) => account.closedAt === null)
      .toSorted((left, right) => Number(right.isDefault) - Number(left.isDefault)),
  );
  const accountOptions = $derived(
    openAccounts.map((account) => ({
      value: account.operatingBankAccountId,
      label: [
        account.name,
        account.accountNumberLastFour === null ? null : `ending ${account.accountNumberLastFour}`,
        account.isDefault ? "Default" : null,
      ]
        .filter((part) => part !== null)
        .join(", "),
    })),
  );

  let accountId = $state("");
  let paidOn = $state("");
  let method = $state<Method>("check");
  let firstCheckNumberText = $state("");
  let reference = $state("");
  let amounts = $state<Record<string, string>>({});
  let failure = $state<StatedFailure | null>(null);
  const intent = new WriteIntent();

  function reset(): void {
    accountId = openAccounts[0]?.operatingBankAccountId ?? "";
    paidOn = todayInUtc();
    method = "check";
    firstCheckNumberText = "";
    reference = "";
    amounts = Object.fromEntries(bills.map((bill) => [bill.vendorBillId, (bill.openMinor / 100).toFixed(2)]));
    failure = null;
  }

  const vendorOrder = $derived([...new Set(bills.map((bill) => bill.vendorId))]);

  const firstCheckNumber = $derived.by((): number | null | "invalid" => {
    const text = firstCheckNumberText.trim();
    if (text === "") return null;
    return /^\d{1,9}$/.test(text) && Number(text) > 0 ? Number(text) : "invalid";
  });

  const refusal = $derived.by((): string | undefined => {
    if (openAccounts.length === 0) return "Add a bank account on the Chart of Accounts screen first.";
    if (accountId === "") return "Pick the account to pay from.";
    if (paidOn === "") return "Enter the payment date.";
    if (method === "check" && firstCheckNumber === "invalid") return "A check number is a whole number.";
    for (const bill of bills) {
      const amountMinor = parseAmountMinor(amounts[bill.vendorBillId] ?? "");
      if (amountMinor === null) return "Every bill needs an amount above zero.";
      if (amountMinor > bill.openMinor) return "A payment cannot be more than is left on the bill.";
    }
    return undefined;
  });

  const totalMinor = $derived(
    bills.reduce((total, bill) => total + (parseAmountMinor(amounts[bill.vendorBillId] ?? "") ?? 0), 0),
  );

  async function commit(): Promise<ActionOutcome> {
    failure = null;
    if (refusal !== undefined) return "refused";
    const first = method === "check" && typeof firstCheckNumber === "number" ? firstCheckNumber : null;
    const { value: outcome } = await intent.submit((key) =>
      payVendorBills(
        {
          operatingBankAccountId: accountId,
          paidOn,
          method,
          reference: reference.trim() || null,
          payments: bills.map((bill) => ({
            vendorBillId: bill.vendorBillId,
            amountMinor: parseAmountMinor(amounts[bill.vendorBillId] ?? "") ?? 0,
            checkNumber: first === null ? null : first + vendorOrder.indexOf(bill.vendorId),
          })),
        },
        key,
      ),
    );
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "Nothing was paid.");
      return "refused";
    }
    onPaid();
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading={bills.length === 1 ? "Pay Bill" : `Pay ${bills.length} Bills`}
  commitLabel={`Pay ${money(totalMinor)}`}
  commitBusyLabel="Paying"
  commitRefusal={refusal}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Paid"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField necessity="required" label="Pay From">
        {#snippet children({ props })}
          <ChoicePicker inputId={props.id} label="Pay From" options={accountOptions} bind:value={accountId} disabled={busy} />
        {/snippet}
      </LabelledField>
      <p class="text-sm text-text-muted">Trust accounts never pay the firm's bills, so they are not listed.</p>
      <div class="grid gap-12 sm:grid-cols-2">
        <DatePicker
          necessity="required"
          label="Payment Date"
          value={civilDateValue(paidOn)}
          onValueChange={(next) => (paidOn = civilDateTextOrEmpty(next))}
          disabled={busy}
        />
        <div class="flex flex-col gap-4">
          <span class="text-sm font-medium">Method</span>
          <SegmentedControl.Root
            value={method}
            onValueChange={(next) => (method = next as Method)}
            aria-label="Payment method"
          >
            <SegmentedControl.Item value="check">Check</SegmentedControl.Item>
            <SegmentedControl.Item value="bank_transfer">Transfer</SegmentedControl.Item>
            <SegmentedControl.Item value="card">Card</SegmentedControl.Item>
            <SegmentedControl.Item value="cash">Cash</SegmentedControl.Item>
          </SegmentedControl.Root>
        </div>
      </div>
      <div class="grid gap-12 sm:grid-cols-2">
        {#if method === "check"}
          <LabelledField label="First Check No.">
            {#snippet children({ props })}
              <Input
                {...props}
                bind:value={firstCheckNumberText}
                inputmode="numeric"
                placeholder="To print"
                disabled={busy}
                autocomplete="off"
              />
            {/snippet}
          </LabelledField>
        {/if}
        <LabelledField label="Reference">
          {#snippet children({ props })}
            <Input {...props} bind:value={reference} maxlength={200} disabled={busy} autocomplete="off" />
          {/snippet}
        </LabelledField>
      </div>

      <section aria-label="Bills being paid" class="flex flex-col divide-y divide-border-default rounded-md border border-border-default">
        {#each bills as bill (bill.vendorBillId)}
          <div class="flex flex-wrap items-center justify-between gap-8 p-12">
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-sm font-semibold">{vendorNames.get(bill.vendorId) ?? "Unnamed vendor"}</span>
              <span class="text-sm text-text-muted">
                {bill.billReference ?? "No bill number"}, {money(bill.openMinor)} left
              </span>
            </span>
            <Input
              aria-label="Amount for {bill.billReference ?? 'this bill'}"
              bind:value={amounts[bill.vendorBillId]}
              inputmode="decimal"
              class="w-128 text-end tabular-nums"
              disabled={busy}
              autocomplete="off"
            />
          </div>
        {/each}
      </section>
    </div>
  {/snippet}
</ActionDialog>

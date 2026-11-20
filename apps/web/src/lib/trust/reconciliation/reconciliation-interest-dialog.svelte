<script lang="ts">
  /*
   * ADD INTEREST: interest the bank credited to the IOLTA account, or interest swept out of it to
   * the bar foundation. It belongs to no matter and never touches a client ledger; it is kept with
   * this reconciliation and counts in its deposited and withdrawn figures. Most banks credit and
   * sweep the same amount on the same day, so one press records both.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import { readAmountMinor } from "$lib/billing/amount-entry.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type { TrustBankReconciliationInterestRequest } from "./reconciliation-api.ts";

  let {
    open = $bindable(false),
    endDate,
    onAdd,
  }: {
    open?: boolean;
    /** The period's end date, the usual day interest posts. */
    endDate: string;
    onAdd: (
      request: TrustBankReconciliationInterestRequest,
      idempotencyKey: string,
    ) => Promise<Failure | null>;
  } = $props();

  let kind = $state<"credited" | "swept">("credited");
  let postedOn = $state("");
  let amountText = $state("");
  let description = $state("");
  let alsoSweep = $state(true);
  let failure = $state<Failure | null>(null);
  let key = "";

  function reset(): void {
    kind = "credited";
    postedOn = endDate;
    amountText = "";
    description = "";
    alsoSweep = true;
    failure = null;
    key = crypto.randomUUID();
  }

  const amount = $derived(readAmountMinor(amountText));
  const refusal = $derived.by((): string | undefined => {
    if (amount.kind === "empty") return "Enter the amount.";
    if (amount.kind === "refused") return amount.reason;
    if (amount.minor <= 0) return "Enter an amount above zero.";
    if (postedOn === "") return "Enter the date.";
    return undefined;
  });

  async function add(): Promise<ActionOutcome> {
    if (amount.kind !== "amount") return "refused";
    const fallback = kind === "credited" ? "Interest credited by bank" : "Interest swept to the bar foundation";
    failure = await onAdd(
      {
        kind,
        postedOn,
        amountMinor: amount.minor,
        description: description.trim() === "" ? fallback : description.trim(),
        ...(kind === "credited" ? { alsoSweep } : {}),
      },
      key,
    );
    return failure === null ? "committed" : "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Add Interest"
  commitLabel="Add Interest"
  commitBusyLabel="Adding"
  commitRefusal={refusal}
  unsavedChanges={amountText !== "" || description !== ""}
  onOpen={reset}
  onCommit={add}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice {failure} title="No Interest Was Added" fallback="The reconciliation is unchanged." />
    {/if}
  {/snippet}
  {#snippet fields({ busy })}
    <div class="@container flex flex-col gap-16">
      <span id="interest-kind-label" class="sr-only">Kind</span>
      <SegmentedControl.Root
        aria-labelledby="interest-kind-label"
        value={kind}
        onValueChange={(next) => (kind = next as "credited" | "swept")}
      >
        <SegmentedControl.Item value="credited">Credited by Bank</SegmentedControl.Item>
        <SegmentedControl.Item value="swept">Swept Out</SegmentedControl.Item>
      </SegmentedControl.Root>
      <div class="grid gap-12 @sm:grid-cols-2">
        <LabelledField necessity="required" label="Amount">
          {#snippet children({ props })}
            <Input {...props} inputmode="decimal" disabled={busy} bind:value={amountText} />
          {/snippet}
        </LabelledField>
        <div class="flex flex-col gap-8">
          <DatePicker
            necessity="required"
            label="Date"
            value={civilDateValue(postedOn)}
            onValueChange={(next) => (postedOn = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
      </div>
      <LabelledField label="Description">
        {#snippet children({ props })}
          <Input {...props} disabled={busy} bind:value={description} />
        {/snippet}
      </LabelledField>
      {#if kind === "credited"}
        <label class="flex items-center gap-8 text-sm">
          <Checkbox bind:checked={alsoSweep} disabled={busy} />
          Also record the same amount swept out on the same day
        </label>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

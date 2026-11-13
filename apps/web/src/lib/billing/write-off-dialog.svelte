<script lang="ts">
  /*
   * Giving up a balance.
   *
   * A WRITE-OFF AND A CREDIT NOTE ARE DIFFERENT FACTS AND ARE KEPT APART ON THE BOOKS. A write-off
   * says the charge was right and the money is not coming. A credit note says the charge was wrong.
   * A firm that recorded one as the other has misstated both its revenue and its client's account,
   * so the dialog says which one this is before anything is typed.
   *
   * IT CANNOT EXCEED WHAT IS STILL OWED. Money already collected is refunded or credited instead,
   * and the ceiling is shown rather than discovered when the server refuses.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Info from "@lucide/svelte/icons/info";
  import { billingFailure, writeOffBalance } from "./billing-api.ts";
  import { amountFieldText, readBoundedAmountMinor } from "./amount-entry.ts";
  import { civilToday, matterUnpaidMinor, type InvoiceRow } from "./invoice-standing.ts";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";

  let {
    open = $bindable(false),
    row,
    matterId,
    money,
    onWrittenOff,
  }: {
    open?: boolean;
    row: InvoiceRow | null;
    matterId: string;
    money: (amountMinor: number) => string;
    onWrittenOff: (amountMinor: number) => void;
  } = $props();

  const fieldPrefix = $props.id();

  const ceiling = $derived(row === null ? 0 : (matterUnpaidMinor(row, matterId) ?? 0));

  let amountText = $state("");
  let reason = $state("");
  let effectiveDate = $state(civilToday());
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    amountText = amountFieldText(ceiling);
    reason = "";
    effectiveDate = civilToday();
    failure = null;
  }

  /** Whether anything has been typed past what opening the panel filled in. */
  const started = $derived(reason.trim() !== "" || amountText !== amountFieldText(ceiling));

  const reading = $derived(readBoundedAmountMinor(amountText, ceiling, money(ceiling)));

  /*
   * The bill being acted on, by its own number. The facts beside it are facts about THAT BILL — what
   * it still owes, what it is worth — never a description of the act, which the heading has already
   * given. Both were in one interpolated string before, which is how a number and a sentence came to
   * share a line behind three different separators across these panels.
   */
  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Bill", number: row?.summary.invoiceNumber ?? null },
    facts: [`this matter still owes ${money(ceiling)}`],
  });

  const refusal = $derived.by((): string | undefined => {
    if (row === null) return "No bill is open.";
    if (reading.kind === "empty") return "Say how much the firm is giving up.";
    if (reading.kind === "refused") return reading.reason;
    if (reason.trim() === "") return "A reason is required.";
    return undefined;
  });

  async function writeOff(): Promise<ActionOutcome> {
    if (row === null || reading.kind !== "amount") return "refused";
    failure = null;
    const outcome = await writeOffBalance(
      fetch,
      row.summary.id,
      { matterId, amountMinor: reading.minor, reason: reason.trim(), effectiveDate },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onWrittenOff(reading.minor);
      return "committed";
    }
    failure = billingFailure(outcome, "The balance is unchanged.");
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Write Off a Balance"
  {subtitle}
  commitLabel="Write Off"
  commitBusyLabel="Writing Off"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={writeOff}
>

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Written Off"
        fallback={failure.fallback}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          A write-off means the charge was correct but won't be paid. It's recorded separately from a credit note and can't exceed what is still owed. To return money already collected, refund or credit it instead.
        </span>
      </p>

      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-amount">Amount</Label>
          <Input id="{fieldPrefix}-amount" disabled={busy} bind:value={amountText} />
        </div>
        <div class="flex flex-col gap-8">
          <DatePicker
            label="Effective Date"
            value={civilDateValue(effectiveDate)}
            onValueChange={(next) => (effectiveDate = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-reason">Reason</Label>
        <Input
          id="{fieldPrefix}-reason"
          placeholder={placeholderOf("Reason")}
          disabled={busy}
          bind:value={reason}
        />
        <p class="text-xs text-text-muted">Why the firm is giving up this balance.</p>
      </div>
    </div>
  {/snippet}
</ActionDialog>

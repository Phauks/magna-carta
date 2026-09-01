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
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FileMinus from "@lucide/svelte/icons/file-minus";
  import Info from "@lucide/svelte/icons/info";
  import { billingFailure, writeOffBalance } from "./billing-api.ts";
  import { amountFieldText, readBoundedAmountMinor } from "./amount-entry.ts";
  import { civilToday, matterUnpaidMinor, type InvoiceRow } from "./invoice-standing.ts";

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
  let working = $state(false);
  let failure = $state<StatedFailure | null>(null);

  $effect(() => {
    if (!open) return;
    amountText = amountFieldText(ceiling);
    reason = "";
    effectiveDate = civilToday();
    failure = null;
  });

  const reading = $derived(readBoundedAmountMinor(amountText, ceiling, money(ceiling)));

  const refusal = $derived.by((): string | null => {
    if (reading.kind === "empty") return "Say how much the firm is giving up.";
    if (reading.kind === "refused") return reading.reason;
    if (reason.trim() === "") return "A reason is required. It is what the books are read against.";
    return null;
  });

  async function writeOff(): Promise<void> {
    if (row === null || working || refusal !== null || reading.kind !== "amount") return;
    working = true;
    failure = null;
    const outcome = await writeOffBalance(
      fetch,
      row.summary.id,
      { matterId, amountMinor: reading.minor, reason: reason.trim(), effectiveDate },
      crypto.randomUUID(),
    );
    working = false;
    if (outcome.kind === "ok") {
      const written = reading.minor;
      open = false;
      onWrittenOff(written);
      return;
    }
    failure = billingFailure(outcome, "The balance is unchanged.");
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Write Off a Balance</Dialog.Title>
    <Dialog.Description>
      {row?.summary.invoiceNumber ?? "This bill"} · this matter still owes {money(ceiling)}
    </Dialog.Description>

    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Written Off"
        fallback={failure.fallback}
      />
    {/if}

    <div class="flex flex-col gap-16">
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          A write-off says the charge was right and the money is not coming: a different fact from a
          credit note, kept separate on the firm's books. It cannot exceed what is still owed; money
          already collected is refunded or credited instead.
        </span>
      </p>

      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-amount">Amount</Label>
          <Input id="{fieldPrefix}-amount" disabled={working} bind:value={amountText} />
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-effective">Effective Date</Label>
          <Input
            id="{fieldPrefix}-effective"
            type="date"
            disabled={working}
            bind:value={effectiveDate}
          />
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-reason">Reason</Label>
        <Input
          id="{fieldPrefix}-reason"
          placeholder={placeholderOf("Reason")}
          disabled={working}
          bind:value={reason}
        />
        <p class="text-xs text-text-muted">Why the firm is giving up this balance.</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <Button variant="secondary" disabled={working} onclick={() => (open = false)}>Cancel</Button>
      <Button
        disabled={working || refusal !== null}
        title={refusal ?? "Give up this balance"}
        onclick={() => void writeOff()}
      >
        <FileMinus class="size-16" aria-hidden="true" />
        {working ? "Writing Off" : "Write Off"}
      </Button>
    </div>
    {#if refusal !== null}
      <p class="text-right text-xs text-text-muted">{refusal}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>

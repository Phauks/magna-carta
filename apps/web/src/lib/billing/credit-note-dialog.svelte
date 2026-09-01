<script lang="ts">
  /*
   * Issuing a credit note against a finalized bill.
   *
   * A CREDIT NOTE IS A SECOND PERMANENT RECORD, NOT AN EDIT. The bill keeps its number, its lines
   * and its wording; only what is owed on it moves. That is why there is no "correct the bill"
   * anywhere on this surface, and why this dialog says the credit cannot be withdrawn: if one is
   * wrong, another is issued.
   *
   * WHERE THE MONEY GOES IS ARITHMETIC, AND IT IS STATED BEFORE THE CONTROL. Up to what is still
   * owed comes straight off the balance; anything beyond that is money already collected and becomes
   * a client credit the firm owes back. Nothing is netted off and nothing goes negative.
   *
   * NAMING THE CHARGE MATTERS, AND NOT ONLY FOR TIDINESS. A fee worked out from a settlement or a
   * recovery is billed as the increment over what earlier bills already charged, so only an
   * ATTRIBUTED credit changes that arithmetic. The picker is therefore a real choice with a
   * consequence, not a filing convenience.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Info from "@lucide/svelte/icons/info";
  import Lock from "@lucide/svelte/icons/lock";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { billingFailure, issueCreditNote, type CreditNoteLineRequest } from "./billing-api.ts";
  import { readAmountMinor } from "./amount-entry.ts";
  import { billUnpaidMinor, civilToday, type InvoiceRow } from "./invoice-standing.ts";

  let {
    open = $bindable(false),
    row,
    matterId,
    money,
    onIssued,
  }: {
    open?: boolean;
    row: InvoiceRow | null;
    matterId: string;
    money: (amountMinor: number) => string;
    /** The note was issued, and this is what became a client credit. */
    onIssued: (clientCreditMinor: number) => void;
  } = $props();

  const fieldPrefix = $props.id();

  /** The value the picker uses for "no particular charge". A Select has no null. */
  const GENERAL_CREDIT = "general";

  let reason = $state("");
  let amountText = $state("");
  let creditedLineId = $state<string>(GENERAL_CREDIT);
  let effectiveDate = $state(civilToday());
  let working = $state(false);
  let failure = $state<StatedFailure | null>(null);

  $effect(() => {
    if (!open) return;
    reason = "";
    amountText = "";
    creditedLineId = GENERAL_CREDIT;
    effectiveDate = civilToday();
    failure = null;
  });

  /** Only this matter's charges: a credit note issued here corrects this matter's own lines. */
  const creditableLines = $derived(
    (row?.detail?.lines ?? []).filter((line) => line.matterId === matterId),
  );
  const lineItems = $derived([
    { value: GENERAL_CREDIT, label: "General credit against this bill" },
    ...creditableLines.map((line) => ({
      value: line.id,
      label: `${line.description} · ${money(line.amountMinor)}`,
    })),
  ]);

  const unpaid = $derived(row === null ? 0 : billUnpaidMinor(row));
  const reading = $derived(readAmountMinor(amountText));
  const amountMinor = $derived(reading.kind === "amount" ? reading.minor : 0);
  const comesOffBalance = $derived(Math.min(amountMinor, Math.max(unpaid, 0)));
  const becomesClientCredit = $derived(amountMinor - comesOffBalance);

  const refusal = $derived.by((): string | null => {
    if (reason.trim() === "") return "A reason is required. It is read years later.";
    if (reading.kind === "empty") return "Say how much is being credited.";
    if (reading.kind === "refused") return reading.reason;
    if (amountMinor <= 0) return "A credit of nothing credits nothing.";
    return null;
  });

  async function issue(): Promise<void> {
    if (row === null || working || refusal !== null) return;
    const attributed = creditableLines.find((line) => line.id === creditedLineId) ?? null;
    const line: CreditNoteLineRequest = {
      matterId,
      // An attributed credit takes the credited charge's own kind, so the correction lands on the
      // same side of the books as the thing it corrects.
      kind: attributed === null ? "adjustment" : creditKindOf(attributed.kind),
      description:
        attributed === null
          ? "Credit against this bill"
          : `Credit — ${attributed.description}`,
      // The contract takes a magnitude: a credit note's direction is the document it is.
      amountMinor,
      creditsInvoiceLineId: attributed === null ? null : attributed.id,
    };
    working = true;
    failure = null;
    const outcome = await issueCreditNote(
      fetch,
      row.summary.id,
      { reason: reason.trim(), effectiveDate, lines: [line] },
      crypto.randomUUID(),
    );
    working = false;
    if (outcome.kind === "ok") {
      open = false;
      onIssued(outcome.value.clientCreditMinor);
      return;
    }
    failure = billingFailure(outcome, "No credit note was issued and the bill is unchanged.");
  }

  /** The credit-note kinds the contract accepts; anything else is recorded as an adjustment. */
  function creditKindOf(invoiceLineKind: string): CreditNoteLineRequest["kind"] {
    switch (invoiceLineKind) {
      case "fee":
      case "cost":
      case "flat_fee":
      case "discount":
      case "interest":
      case "tax":
        return invoiceLineKind;
      default:
        return "adjustment";
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Issue a Credit Note</Dialog.Title>
    <Dialog.Description>
      Against {row?.summary.invoiceNumber ?? "this bill"} — a second permanent record standing beside
      it
    </Dialog.Description>

    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Credited"
        fallback={failure.fallback}
      />
    {/if}

    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-reason">Reason</Label>
        <Textarea
          id="{fieldPrefix}-reason"
          rows={3}
          disabled={working}
          bind:value={reason}
        />
        <p class="text-xs text-text-muted">
          In your own words: what was charged that should not have been, and why. It is read years
          later.
        </p>
      </div>

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
        <Label id="{fieldPrefix}-line-label">Credits Which Charge</Label>
        <Select.Root
          type="single"
          items={lineItems}
          bind:value={creditedLineId}
          allowDeselect={false}
          disabled={working}
        >
          <Select.Trigger aria-labelledby="{fieldPrefix}-line-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each lineItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
        <p class="text-xs text-text-muted">
          Naming the charge matters for a fee worked out from a settlement or a recovery: only an
          attributed credit changes that arithmetic.
        </p>
      </div>

      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          {#if amountMinor === 0}
            {unpaid > 0
              ? `Up to ${money(unpaid)} comes straight off what is owed; anything beyond that is money already collected and becomes a recorded client credit the firm owes back.`
              : "This bill is fully paid, so the whole credit becomes a recorded client credit the firm owes back."}
          {:else if becomesClientCredit === 0}
            The whole {money(amountMinor)} comes off what the client owes.
          {:else if comesOffBalance === 0}
            The whole {money(amountMinor)} becomes a client credit the firm owes back: this bill has
            already been paid.
          {:else}
            {money(comesOffBalance)} comes off what is owed; {money(becomesClientCredit)} becomes a
            client credit the firm owes back.
          {/if}
          Nothing is netted off and nothing goes negative.
        </span>
      </p>
      <p class="flex items-start gap-8 text-sm text-status-warning-subtle-foreground">
        <Lock class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>A credit note cannot be edited or withdrawn once issued. If one is wrong, issue another.</span>
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <Button variant="secondary" disabled={working} onclick={() => (open = false)}>Cancel</Button>
      <Button
        disabled={working || refusal !== null}
        title={refusal ?? "Issue this credit note"}
        onclick={() => void issue()}
      >
        <Undo2 class="size-16" aria-hidden="true" />
        {working ? "Issuing" : "Issue Credit Note"}
      </Button>
    </div>
    {#if refusal !== null}
      <p class="text-right text-xs text-text-muted">{refusal}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>

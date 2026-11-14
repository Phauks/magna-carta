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
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import Info from "@lucide/svelte/icons/info";
  import Lock from "@lucide/svelte/icons/lock";
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
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    reason = "";
    amountText = "";
    creditedLineId = GENERAL_CREDIT;
    effectiveDate = civilToday();
    failure = null;
  }

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
    if (reason.trim() === "") return "A reason is required. It is read years later.";
    if (reading.kind === "empty") return "Say how much is being credited.";
    if (reading.kind === "refused") return reading.reason;
    if (amountMinor <= 0) return "A credit of nothing credits nothing.";
    return undefined;
  });

  async function issue(): Promise<ActionOutcome> {
    if (row === null) return "refused";
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
    failure = null;
    const outcome = await issueCreditNote(
      fetch,
      row.summary.id,
      { reason: reason.trim(), effectiveDate, lines: [line] },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {

      onIssued(outcome.value.clientCreditMinor);
      return "committed";
    }
    failure = billingFailure(outcome, "No credit note was issued and the bill is unchanged.");
    return "refused";
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

<ActionDialog
  bind:open
  heading="Issue a Credit Note"
  {subtitle}
  commitLabel="Issue Credit Note"
  commitBusyLabel="Issuing"
  commitRefusal={refusal}
  unsavedChanges={reason.trim() !== "" || amountText !== ""}
  onOpen={reset}
  onCommit={issue}
>

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Credited"
        fallback={failure.fallback}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-reason">Reason</Label>
        <Textarea id="{fieldPrefix}-reason" rows={3} disabled={busy} bind:value={reason} />
        <p class="text-xs text-text-muted">
          In your own words: what was charged that should not have been, and why. It is read years
          later.
        </p>
      </div>

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
        <Label id="{fieldPrefix}-line-label">Credits Which Charge</Label>
        <Select.Root
          type="single"
          items={lineItems}
          bind:value={creditedLineId}
          allowDeselect={false}
          disabled={busy}
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
              ? `Up to ${money(unpaid)} comes off what is owed. Anything more is money already collected and becomes a credit owed to the client.`
              : "This bill is fully paid, so the whole credit becomes a recorded client credit the firm owes back."}
          {:else if becomesClientCredit === 0}
            The whole {money(amountMinor)} comes off what the client owes.
          {:else if comesOffBalance === 0}
            The whole {money(amountMinor)} becomes a client credit the firm owes back: this bill has
            already been paid.
          {:else}
            {money(comesOffBalance)} comes off what is owed, and {money(becomesClientCredit)} becomes a credit owed to the client.
          {/if}
          Nothing is netted off and nothing goes negative.
        </span>
      </p>
      <p class="flex items-start gap-8 text-sm text-status-warning-subtle-foreground">
        <Lock class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          A credit note cannot be edited or withdrawn once issued. If one is wrong, issue another.
        </span>
      </p>
    </div>
  {/snippet}
</ActionDialog>

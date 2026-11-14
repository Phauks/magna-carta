<script lang="ts">
  /*
   * Editing one line of a draft bill.
   *
   * BILL REVIEW EDITS WHAT THE CLIENT IS TOLD. The time entry or cost this line was composed from is
   * the timekeeper's own record and is not touched: trimming a line changes the bill, not the
   * history of the work. That sentence is the whole reason this dialog exists rather than sending
   * somebody to the Time tab, so it is stated where the editing happens.
   *
   * ONLY A DRAFT. A finalized bill's lines are frozen by the database itself, so this never opens on
   * one; the register's own verbs are what keep it that way.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Info from "@lucide/svelte/icons/info";
  import { billingFailure, updateInvoiceLine, type InvoiceLine } from "./billing-api.ts";
  import { amountFieldText, readAmountMinor } from "./amount-entry.ts";

  let {
    open = $bindable(false),
    invoiceId,
    invoiceNumber,
    line,
    onSaved,
  }: {
    open?: boolean;
    invoiceId: string | null;
    /** That invoice's own number — which bill this line is on, said once in the panel's own line. */
    invoiceNumber: string | null;
    /** The line being edited. Null closes the dialog's subject with it. */
    line: InvoiceLine | null;
    onSaved: () => void;
  } = $props();

  const fieldPrefix = $props.id();

  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Bill", number: invoiceNumber },
  });

  let description = $state("");
  let amountText = $state("");
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    if (line === null) return;
    description = line.description;
    amountText = amountFieldText(line.amountMinor);
    failure = null;
  }

  const reading = $derived(readAmountMinor(amountText));

  const refusal = $derived.by((): string | undefined => {
    if (description.trim() === "") return "A line the client reads cannot be blank.";
    if (reading.kind === "empty") return "Say what this line charges.";
    if (reading.kind === "refused") return reading.reason;
    return undefined;
  });

  async function save(): Promise<ActionOutcome> {
    if (invoiceId === null || line === null || reading.kind !== "amount") return "refused";
    failure = null;
    const outcome = await updateInvoiceLine(
      fetch,
      invoiceId,
      line.id,
      { description: description.trim(), amountMinor: reading.minor },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {

      onSaved();
      return "committed";
    }
    failure = billingFailure(outcome, "The line is unchanged.");
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Edit Line"
  {subtitle}
  commitLabel="Save Line"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  unsavedChanges={
    line !== null &&
    (description !== line.description || amountText !== amountFieldText(line.amountMinor))
  }
  onOpen={reset}
  onCommit={save}
>

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice failure={failure.failure} title="Nothing Changed" fallback={failure.fallback} />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-description">Line Text</Label>
        <Textarea
          id="{fieldPrefix}-description"
          rows={3}
          disabled={busy}
          bind:value={description}
        />
      </div>
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-amount">Amount</Label>
        <Input id="{fieldPrefix}-amount" disabled={busy} bind:value={amountText} />
      </div>
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          Bill review changes only what the client sees. The original entry stays as the timekeeper recorded it. A negative line adds a named discount to the bill.
        </span>
      </p>
    </div>
  {/snippet}
</ActionDialog>

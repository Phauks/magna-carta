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
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Info from "@lucide/svelte/icons/info";
  import { billingFailureText, updateInvoiceLine, type InvoiceLine } from "./billing-api.ts";
  import { amountFieldText, readAmountMinor } from "./amount-entry.ts";

  let {
    open = $bindable(false),
    invoiceId,
    line,
    onSaved,
  }: {
    open?: boolean;
    invoiceId: string | null;
    /** The line being edited. Null closes the dialog's subject with it. */
    line: InvoiceLine | null;
    onSaved: () => void;
  } = $props();

  const fieldPrefix = $props.id();

  let description = $state("");
  let amountText = $state("");
  let working = $state(false);
  let failure = $state<string | null>(null);

  $effect(() => {
    if (!open || line === null) return;
    description = line.description;
    amountText = amountFieldText(line.amountMinor);
    failure = null;
  });

  const reading = $derived(readAmountMinor(amountText));

  const refusal = $derived.by((): string | null => {
    if (description.trim() === "") return "A line the client reads cannot be blank.";
    if (reading.kind === "empty") return "Say what this line charges.";
    if (reading.kind === "refused") return reading.reason;
    return null;
  });

  async function save(): Promise<void> {
    if (invoiceId === null || line === null || working || refusal !== null) return;
    if (reading.kind !== "amount") return;
    working = true;
    failure = null;
    const outcome = await updateInvoiceLine(
      fetch,
      invoiceId,
      line.id,
      { description: description.trim(), amountMinor: reading.minor },
      crypto.randomUUID(),
    );
    working = false;
    if (outcome.kind === "ok") {
      open = false;
      onSaved();
      return;
    }
    failure = billingFailureText(outcome, "The line is unchanged.");
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Edit Line</Dialog.Title>
    <Dialog.Description>
      Bill review edits what the client is told: the underlying entry stays the timekeeper&rsquo;s own
      record.
    </Dialog.Description>

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Nothing Changed</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-description">Line Text</Label>
        <Textarea
          id="{fieldPrefix}-description"
          rows={3}
          disabled={working}
          bind:value={description}
        />
      </div>
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-amount">Amount</Label>
        <Input id="{fieldPrefix}-amount" disabled={working} bind:value={amountText} />
      </div>
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          A negative line is a first-class shape on a draft: a discount is a named reduction on the
          bill, never a silent edit of a fee line.
        </span>
      </p>
    </div>

    <div class="flex justify-end gap-8">
      <Button variant="secondary" disabled={working} onclick={() => (open = false)}>Cancel</Button>
      <Button
        disabled={working || refusal !== null}
        title={refusal ?? "Save this line"}
        onclick={() => void save()}
      >
        {working ? "Saving" : "Save Line"}
      </Button>
    </div>
    {#if refusal !== null}
      <p class="text-right text-xs text-text-muted">{refusal}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>

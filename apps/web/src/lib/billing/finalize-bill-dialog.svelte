<script lang="ts">
  /*
   * Finalizing a bill: the moment a working document becomes evidence.
   *
   * THE DIALOG'S JOB IS TO STATE WHAT IS ABOUT TO BE TRUE. Finalization is one atomic write — all of
   * it, or none of it — and the five things it does are the five things a person is consenting to.
   * They are listed rather than summarized, because "Finalize?" is not informed consent to drawing a
   * number that can never be given back.
   *
   * THERE IS NO UN-FINALIZE, AND THE DIALOG SAYS SO BEFORE THE CONTROL. Afterwards nothing about the
   * bill can be edited. A correction is a credit note recorded beside it.
   *
   * THE NUMBER IS NOT PREVIEWED. The mockup showed the sequence's next value; the platform draws it
   * inside the same atomic write, and no read hands it out beforehand — so showing one here would be
   * a guess that is wrong the moment two people finalize at once. The dialog states that a number is
   * drawn, and the acknowledgement afterwards says which one it was.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Card from "@magna-carta/design-system/card";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Info from "@lucide/svelte/icons/info";
  import Lock from "@lucide/svelte/icons/lock";
  import Stamp from "@lucide/svelte/icons/stamp";
  import { billingFailure, finalizeInvoice } from "./billing-api.ts";
  import { civilDatePlusDays, civilToday, draftTotalMinor, type InvoiceRow } from "./invoice-standing.ts";

  let {
    open = $bindable(false),
    row,
    money,
    onFinalized,
  }: {
    open?: boolean;
    /** The draft being finalized. Null closes the dialog's subject with it. */
    row: InvoiceRow | null;
    money: (amountMinor: number) => string;
    /** The bill was finalized, and this is the number it drew. */
    onFinalized: (invoiceNumber: string) => void;
  } = $props();

  const fieldPrefix = $props.id();

  let issueDate = $state(civilToday());
  let dueDate = $state(civilDatePlusDays(civilToday(), 30));
  let working = $state(false);
  let failure = $state<StatedFailure | null>(null);

  const total = $derived(row === null ? 0 : draftTotalMinor(row.detail));

  $effect(() => {
    if (!open) return;
    issueDate = civilToday();
    dueDate = civilDatePlusDays(civilToday(), 30);
    failure = null;
  });

  const refusal = $derived.by((): string | null => {
    if (issueDate === "") return "A bill has to say when it was issued.";
    if (dueDate === "") return "A bill has to say when it falls due.";
    if (dueDate < issueDate) return "A bill cannot fall due before it was issued.";
    return null;
  });

  async function finalize(): Promise<void> {
    if (row === null || working || refusal !== null) return;
    working = true;
    failure = null;
    const outcome = await finalizeInvoice(
      fetch,
      row.summary.id,
      { issueDate, dueDate },
      // A retried finalize that drew a second number would consume one the sequence can never
      // give back, so the key is what makes the retry safe.
      crypto.randomUUID(),
    );
    working = false;
    if (outcome.kind === "ok") {
      open = false;
      onFinalized(outcome.value.invoiceNumber);
      return;
    }
    failure = billingFailure(outcome, "The bill is still a draft and nothing was locked.");
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Finalize This Bill</Dialog.Title>
    <Dialog.Description>
      Draft · {money(total)}
    </Dialog.Description>

    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Finalized"
        fallback={failure.fallback}
      />
    {/if}

    <div class="flex flex-col gap-16">
      <Card.Root class="gap-8 py-12">
        <Card.Header class="px-12">
          <Card.Title class="text-sm">One atomic write: all of it, or none of it</Card.Title>
        </Card.Header>
        <Card.Content class="px-12">
          <ul class="flex flex-col gap-4 text-xs text-text-muted">
            <li>The next number in the firm's sequence is drawn.</li>
            <li>The client details and every line's wording are copied onto the bill.</li>
            <li>Every claimed time and cost entry locks as billed.</li>
            <li>
              The per-matter balance is created with the ceiling that makes over-application
              impossible.
            </li>
            <li>The accounts-receivable entry posts to the firm's ledger.</li>
          </ul>
        </Card.Content>
      </Card.Root>

      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-issue">Issue Date</Label>
          <Input id="{fieldPrefix}-issue" type="date" disabled={working} bind:value={issueDate} />
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-due">Due Date</Label>
          <Input id="{fieldPrefix}-due" type="date" disabled={working} bind:value={dueDate} />
        </div>
      </div>

      <p class="flex items-start gap-8 text-sm text-status-warning-subtle-foreground">
        <Lock class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          Afterwards nothing about the bill can be edited, and there is no un-finalize. A correction
          is a credit note recorded beside it.
        </span>
      </p>
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          A firm that has not mapped which of its ledger accounts play the billing roles is refused
          here by name, not posted somewhere plausible.
        </span>
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <span class="mr-auto max-w-sm text-xs text-text-subtle">
        Requires the finalize capability: drafting and finalizing are separate permissions.
      </span>
      <Button variant="secondary" disabled={working} onclick={() => (open = false)}>Cancel</Button>
      <Button
        disabled={working || refusal !== null}
        title={refusal ?? "Draw the number and post the receivable"}
        onclick={() => void finalize()}
      >
        <Stamp class="size-16" aria-hidden="true" />
        {working ? "Finalizing" : "Finalize"}
      </Button>
    </div>
    {#if refusal !== null}
      <p class="text-right text-xs text-text-muted">{refusal}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>

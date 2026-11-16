<script lang="ts">
  /*
   * Before anything is numbered: the checks about to print, in the order they will come out, and
   * the number on the first sheet in the printer.
   *
   * THE NUMBER IS THE READER'S. It starts at the account's next number and can be changed for this
   * batch; the number beside every check follows it as it is typed, so the list is the paper the
   * reader should see come out. Nothing is numbered until Print Checks. A number already used on
   * the account is refused by the server, which says so in the panel's failure band; the field
   * turns red and says nothing under itself.
   *
   * The same panel asks again for a reprint, so printing a misprinted check again is this one step.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type { TrustCheckToPrint } from "./checks-api.ts";
  import {
    loadPaperLine,
    matterLabel,
    numberAlreadyUsed,
    typedCheckNumber,
  } from "./checks-model.ts";

  let {
    open = $bindable(false),
    payments,
    suggestedFirst,
    again = false,
    accountName,
    money,
    manageRefusal,
    onPrint,
  }: {
    open?: boolean;
    /** The payments to print, in the order they will be numbered. */
    payments: readonly TrustCheckToPrint[];
    /** The account's next number, where the first check starts unless the reader changes it. */
    suggestedFirst: number;
    /** Whether these are being printed again after a misprint or a void. */
    again?: boolean;
    accountName: string | null;
    money: (amountMinor: number) => string;
    /** Why this reader may not print, or undefined where they may. */
    manageRefusal: string | undefined;
    /** Number and print the batch from `first`. Null when it printed, the failure when not. */
    onPrint: (first: number) => Promise<Failure | null>;
  } = $props();

  let firstText = $state("");
  let failure = $state<Failure | null>(null);
  /** The text the server refused as already used; the field stays red until it changes. */
  let refusedText = $state<string | null>(null);

  function opened(): void {
    firstText = String(suggestedFirst);
    failure = null;
    refusedText = null;
  }

  const first = $derived(typedCheckNumber(firstText));
  const count = $derived(payments.length);

  const heading = $derived(
    `Print ${count === 1 ? "1 Check" : `${count} Checks`}${again ? " Again" : ""}`,
  );
  const subtitle = $derived<RecordSubject>({
    facts: accountName === null ? [] : [accountName],
  });

  const refusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (count === 0) return "No payment is chosen.";
    if (first === null) return "Give the number on the first check in the printer.";
    if (refusedText === firstText) return "That number is already used on this account.";
    return undefined;
  });

  async function print(): Promise<ActionOutcome> {
    if (first === null) return "refused";
    failure = null;
    const outcome = await onPrint(first);
    if (outcome === null) return "committed";
    failure = outcome;
    if (numberAlreadyUsed(outcome.problem?.detail)) refusedText = firstText;
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  width="wide"
  {heading}
  {subtitle}
  commitLabel={count === 1 ? "Print Check" : "Print Checks"}
  commitBusyLabel="Printing"
  commitRefusal={refusal}
  unsavedChanges={false}
  onOpen={opened}
  onCommit={print}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        {failure}
        title="The Checks Were Not Printed"
        fallback="No number was used. The payments are still waiting to be printed."
        whenSilent="Couldn't connect. No number was used, and trying again won't number them twice."
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-wrap items-end gap-16">
        <div class="w-full sm:w-3xs">
          <LabelledField necessity="required" label="First Check Number">
            {#snippet children({ props })}
              <Input
                {...props}
                bind:value={firstText}
                inputmode="numeric"
                autocomplete="off"
                class="tabular-nums"
                disabled={busy}
                aria-invalid={first === null || refusedText === firstText}
              />
            {/snippet}
          </LabelledField>
        </div>
        {#if first !== null}
          <p class="min-w-0 flex-1 pb-8 text-sm text-text-muted" aria-live="polite">
            {loadPaperLine(first, count)}
          </p>
        {/if}
      </div>
      <DataTable.Root>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Check No.</DataTable.Head>
            <DataTable.Head>Payee</DataTable.Head>
            <DataTable.Head class="text-end">Amount</DataTable.Head>
            <DataTable.Head class="hidden sm:table-cell">Matter</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each payments as payment, index (payment.trustMovementId)}
            <DataTable.Row>
              <DataTable.Cell class="tabular-nums">{first === null ? "" : first + index}</DataTable.Cell>
              <DataTable.Cell>{payment.payee}</DataTable.Cell>
              <DataTable.Cell class="text-end tabular-nums">{money(payment.amountMinor)}</DataTable.Cell>
              <DataTable.Cell class="hidden sm:table-cell">{matterLabel(payment)}</DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    </div>
  {/snippet}
</ActionDialog>

<script lang="ts">
  /*
   * Before anything is numbered: how many checks, their total, and the numbers they print on.
   *
   * A PLAIN SUMMARY, AND NOTHING TO CHANGE. The first check number is set on the Checks screen,
   * beside the list it numbers, so this panel only reads it back. Nothing is numbered until Print
   * Checks; once it is, the checks are recorded as printed and nothing more is asked. A check that
   * came out wrong is returned to the list from its row.
   *
   * A failure that leaves the batch unprinted stays here, where trying again is one press. A number
   * already used on the account is not this panel's to fix, so the screen closes it and says so
   * beside the field.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { fromMinor, toMinor } from "@magna-carta/money/format";
  import { currencyFromCode, sum } from "@magna-carta/money/money";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type { TrustCheckToPrint } from "./checks-api.ts";
  import { checkRunText } from "./checks-model.ts";

  let {
    open = $bindable(false),
    payments,
    firstCheckNumber,
    accountName,
    money,
    manageRefusal,
    onPrint,
  }: {
    open?: boolean;
    /** The payments to print, in the order they will be numbered. */
    payments: readonly TrustCheckToPrint[];
    /** The number on the first check, as set on the screen. */
    firstCheckNumber: number;
    accountName: string | null;
    money: (amountMinor: number) => string;
    /** Why this reader may not print, or undefined where they may. */
    manageRefusal: string | undefined;
    /** Number and print the batch. Null closes the panel; a failure keeps it open and shown. */
    onPrint: () => Promise<Failure | null>;
  } = $props();

  let failure = $state<Failure | null>(null);

  function opened(): void {
    failure = null;
  }

  const count = $derived(payments.length);
  const total = $derived(
    payments.length === 0
      ? 0
      : toMinor(
          sum(
            payments.map((payment) =>
              fromMinor(payment.amountMinor, currencyFromCode(payment.currency)),
            ),
          ),
        ),
  );

  const heading = $derived(`Print ${count === 1 ? "1 Check" : `${count} Checks`}`);
  const subtitle = $derived<RecordSubject>({
    facts: accountName === null ? [] : [accountName],
  });

  const refusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (count === 0) return "No payment is chosen.";
    return undefined;
  });

  async function print(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await onPrint();
    if (outcome === null) return "committed";
    failure = outcome;
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
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

  {#snippet fields()}
    <DefinitionList.Root>
      <DefinitionList.Row term="Checks">
        <span class="tabular-nums">{count}</span>
      </DefinitionList.Row>
      <DefinitionList.Row term="Total">
        <span class="tabular-nums">{money(total)}</span>
      </DefinitionList.Row>
      <DefinitionList.Row term={count === 1 ? "Check Number" : "Check Numbers"}>
        <span class="tabular-nums">{checkRunText(firstCheckNumber, count)}</span>
      </DefinitionList.Row>
    </DefinitionList.Root>
  {/snippet}
</ActionDialog>

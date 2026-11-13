<script lang="ts">
  /*
   * Move to Another Ledger — one dialog, shared by Time, Fees and Costs.
   *
   * THE CHOICE COMES FIRST AND THE CONSEQUENCES FOLLOW IT. Three destinations, each saying what a
   * record of that kind IS; pick one and the dialog states what carries and what does not FOR THAT
   * PAIR, before the move rather than after it. The differences between the pairs are the whole
   * decision, so a general sentence about moving records would be no help at the moment it is read.
   *
   * THE KEPT NUMBER IS SAID LAST, NOT BURIED. It is the surprising part — a record on the Fees
   * ledger wearing a number whose shape names Time — so it is the last thing read before the verb.
   *
   * THE MOVE ITSELF IS NOT WIRED. It is one cross-table write with its own refusals, and no route
   * performs it yet; the caller says what it waits on and the shell renders the verb disabled beside
   * its Soon mark. Everything else here is real: the refusal that stops a record moving at all, the
   * destinations, and the per-pair carry statement.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import Check from "@lucide/svelte/icons/check";
  import Info from "@lucide/svelte/icons/info";
  import X from "@lucide/svelte/icons/x";
  import {
    LEDGER_KINDS,
    LEDGER_NAME,
    LEDGER_RECORD_NAME,
    LEDGER_SHAPE,
    carryFacts,
    keptNumberNote,
    type LedgerKind,
  } from "./reclassification.ts";

  let {
    open = $bindable(false),
    from,
    entryNumber,
    description,
    amountMinor,
    money,
    moveDependency,
    onMove,
  }: {
    open?: boolean;
    /** The ledger the record is on now. It is offered as a destination, refused, saying so. */
    from: LedgerKind;
    entryNumber: string | null;
    /** What the record says it is for, so the reader can see they are moving the right one. */
    description: string;
    amountMinor: number | null;
    money: (amountMinor: number) => string;
    /**
     * What the move waits on, as a noun phrase. Given, the verb renders disabled with its Soon
     * mark; withheld, the verb acts.
     */
    moveDependency?: string;
    onMove?: (to: LedgerKind) => void;
  } = $props();

  let target = $state<LedgerKind | null>(null);

  const facts = $derived(
    target === null ? null : carryFacts(from, target, { amountMinor }, money),
  );

  function chooseTitle(kind: LedgerKind): string {
    return kind === from
      ? "Current location"
      : `Move it to the ${LEDGER_NAME[kind]} ledger`;
  }

  async function move(): Promise<ActionOutcome> {
    if (target === null) return "refused";
    onMove?.(target);
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  width="wide"
  heading="Move to Another Ledger"
  commitLabel="Move"
  commitRefusal={target === null ? "Choose a ledger first." : undefined}
  commitSoon={moveDependency === undefined ? undefined : { reason: moveDependency }}
  unsavedChanges={false}
  onOpen={() => (target = null)}
  onCommit={move}
>
  {#snippet subtitle()}
    {LEDGER_RECORD_NAME[from]}
    {#if entryNumber !== null}<span class="tabular-nums">{entryNumber}</span> ·{/if}
    {description}
  {/snippet}

  {#snippet fields()}
    <div class="grid gap-8 sm:grid-cols-3">
      {#each LEDGER_KINDS as kind (kind)}
        <ChoiceRow
          selected={kind === target}
          disabled={kind === from}
          title={chooseTitle(kind)}
          onclick={() => (target = kind)}
        >
          {LEDGER_RECORD_NAME[kind]}
          {#snippet detail()}
            {kind === from ? "where it is now" : LEDGER_SHAPE[kind]}
          {/snippet}
        </ChoiceRow>
      {/each}
    </div>

    {#if facts === null}
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>Choose the ledger this record belongs on.</span>
      </p>
    {:else}
      <ul class="flex flex-col gap-4 text-sm">
        {#each facts.keeps as fact (fact)}
          <li class="flex items-start gap-8">
            <Check
              class="mt-4 size-16 shrink-0 text-status-success-subtle-foreground"
              aria-hidden="true"
            />
            <span>{fact}</span>
          </li>
        {/each}
        {#each facts.loses as fact (fact)}
          <li class="flex items-start gap-8 text-text-muted">
            <X class="mt-4 size-16 shrink-0" aria-hidden="true" />
            <span>{fact}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="text-xs text-text-muted">{keptNumberNote(entryNumber)}</p>
  {/snippet}
</ActionDialog>

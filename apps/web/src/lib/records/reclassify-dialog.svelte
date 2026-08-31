<script lang="ts">
  /*
   * Move to Another Ledger — one dialog, shared by Time, Fees and Costs.
   *
   * THE CHOICE COMES FIRST AND THE CONSEQUENCES FOLLOW IT. Three destinations, each saying what a
   * record of that kind IS; pick one and the dialog states what carries and what does not FOR THAT
   * PAIR, before the move rather than after it. The differences between the pairs are the whole
   * decision, so a general sentence about moving records would be no help at the moment it is read.
   *
   * THE KEPT NUMBER IS SAID IN THE FOOTER, NOT BURIED. It is the surprising part — a record on the
   * Fees ledger wearing a number whose shape names Time — so it is stated where the reader is about
   * to press the verb.
   *
   * THE MOVE ITSELF IS NOT WIRED. It is one cross-table write with its own refusals, and no route
   * performs it yet; the caller says what it waits on and the verb renders disabled beside its Soon
   * mark. Everything else here is real: the refusal that stops a record moving at all, the
   * destinations, and the per-pair carry statement.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import ArrowRightLeft from "@lucide/svelte/icons/arrow-right-left";
  import Check from "@lucide/svelte/icons/check";
  import Info from "@lucide/svelte/icons/info";
  import X from "@lucide/svelte/icons/x";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
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

  $effect(() => {
    if (!open) return;
    target = null;
  });

  const facts = $derived(
    target === null ? null : carryFacts(from, target, { amountMinor }, money),
  );

  function chooseTitle(kind: LedgerKind): string {
    return kind === from
      ? "This is where the record is now"
      : `Move it to the ${LEDGER_NAME[kind]} ledger`;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false} class="max-w-2xl">
    <Dialog.Title>Move to Another Ledger</Dialog.Title>
    <Dialog.Description>
      {LEDGER_RECORD_NAME[from]}
      {#if entryNumber !== null}<span class="tabular-nums">{entryNumber}</span> ·{/if}
      {description}
    </Dialog.Description>

    <div class="flex flex-col gap-16">
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
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
      {#if moveDependency === undefined}
        <Button
          disabled={target === null}
          title={target === null
            ? "Choose a ledger first"
            : `Move this record to the ${LEDGER_NAME[target]} ledger`}
          onclick={() => {
            if (target !== null) onMove?.(target);
          }}
        >
          <ArrowRightLeft class="size-16" aria-hidden="true" />
          Move
        </Button>
      {:else}
        <SoonAffordance reason={moveDependency}>
          {#snippet control(soon)}
            <Button {...soon}>
              <ArrowRightLeft class="size-16" aria-hidden="true" />
              Move
            </Button>
          {/snippet}
        </SoonAffordance>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

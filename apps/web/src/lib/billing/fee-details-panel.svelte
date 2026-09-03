<script lang="ts">
  /*
   * The details panel beside the fee ledger: the SMALLER details.
   *
   * THREE FACES, ONE PANEL. Nothing selected, it speaks for the matter's fee position and the
   * arrangement in force. One fee selected, it shows that fee — its identity, its standing, its few
   * figures, and the two verbs that belong to a list rather than to a record. Several selected, it
   * counts them and offers nothing.
   *
   * THE PANEL OPENS A RECORD; IT DOES NOT EDIT ONE. Edit lives in the record window's header, where
   * a reader who has learned it once finds it on every kind of record. Print stays here, because
   * printing from the list without opening anything is a real convenience and printing is not
   * editing.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Printer from "@lucide/svelte/icons/printer";
  import X from "@lucide/svelte/icons/x";
  import { gapCellTitle } from "./fee-gaps.ts";
  import {
    billingSentence,
    countsInTotals,
    entryNumberTitle,
    feePosition,
    feeStatusKey,
    incompleteNote,
    type FeeRecord,
  } from "./fee-record.ts";
  import { timekeeperText } from "./fee-columns.ts";

  let {
    fees,
    selected,
    money,
    onOpen,
    onPrint,
    onLetGo,
  }: {
    /** Every fee on the matter, for the face the panel shows with nothing selected. */
    fees: readonly FeeRecord[];
    selected: readonly FeeRecord[];
    money: (amountMinor: number) => string;
    onOpen: (fee: FeeRecord) => void;
    onPrint: (fee: FeeRecord) => void;
    onLetGo: () => void;
  } = $props();

  const sole = $derived(selected.length === 1 ? (selected[0] ?? null) : null);
  const position = $derived(feePosition(fees));
  const live = $derived(fees.filter(countsInTotals));
  const voided = $derived(fees.length - live.length);

  const heading = $derived.by((): string => {
    const fee = sole;
    if (fee === null) return "";
    return fee.entryNumber ?? "Fee";
  });
</script>

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right tabular-nums" {title}>{value}</dd>
  </div>
{/snippet}

<aside
  class="flex h-full w-full flex-col border-l border-border-default bg-surface-default"
  aria-label="Fee details"
>
  {#if sole !== null}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold" title={entryNumberTitle(sole)}>
          {heading}
        </h2>
        <p class="text-xs text-text-muted">{sole.description}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of this fee and show the matter's position"
        aria-label="Let go of this fee and show the matter's position"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <div class="flex flex-wrap gap-8">
        <Button variant="secondary" size="sm" onclick={() => onOpen(sole)}>
          <FolderOpen class="size-16" aria-hidden="true" />
          Open
        </Button>
        <Button variant="secondary" size="sm" onclick={() => onPrint(sole)}>
          <Printer class="size-16" aria-hidden="true" />
          Print
        </Button>
      </div>

      <dl class="flex flex-col gap-4 border-t border-border-default pt-12 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Status</dt>
          <dd>
            <Badge {...statusBadgeAttributes(feeStatusKey(sole.status))}>
              {statusEntry(feeStatusKey(sole.status)).label}
            </Badge>
          </dd>
        </div>
        {@render fact("Date", formatDate(sole.feeDate))}
        {@render fact("Timekeeper", timekeeperText(sole))}
        {@render fact(
          "Amount",
          sole.amountMinor === null ? "Not recorded" : money(sole.amountMinor),
        )}
        {@render fact("Billing", sole.billable ? "Billable" : "Non-billable", billingSentence(sole.billable))}
        {@render fact("Attachments", "—", gapCellTitle("attachments"))}
      </dl>

      {#if sole.incomplete}
        <p class="text-xs text-status-warning-subtle-foreground">{incompleteNote(sole)}</p>
      {/if}
      {#if sole.invoiceNumber !== null}
        <p class="text-xs text-text-muted">
          Billed on <span class="tabular-nums">{sole.invoiceNumber}</span>. A record on a finalized
          bill is evidence; the correction is a credit note beside it.
        </p>
      {/if}
    </div>
  {:else if selected.length > 1}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">{selected.length} Fees Selected</h2>
        <p class="text-xs text-text-muted">Nothing here acts on more than one</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of all {selected.length} selected fees"
        aria-label="Let go of all {selected.length} selected fees"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <p class="text-sm text-text-muted">
        Select one fee for its details. The row menu is where a verb acts on a whole selection.
      </p>
    </div>
  {:else}
    <header class="border-b border-border-default p-12">
      <h2 class="text-base leading-tight font-semibold">This Matter&rsquo;s Fees</h2>
      <p class="text-xs text-text-muted">Select a fee for its details</p>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact(
          "Fees",
          voided === 0 ? String(live.length) : `${String(live.length)} (${String(voided)} void)`,
        )}
        {@render fact(
          "Unbilled",
          money(position.unbilledMinor),
          "Billable fees no finalized invoice has taken up. A draft bill claims them on the Billing tab.",
        )}
        {@render fact(
          "Billed",
          money(position.billedMinor),
          "Fees a finalized invoice has taken up.",
        )}
      </dl>
    </div>
  {/if}
</aside>

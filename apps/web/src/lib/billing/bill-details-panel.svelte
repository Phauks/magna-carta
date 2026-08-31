<script lang="ts">
  /*
   * The details panel beside the bill register: the SMALLER details, and nothing else.
   *
   * EVERY OPERATION LIVES IN THE INVOICE WINDOW. This panel carries identity, the standing chip
   * with its credit-note marker, a few figures, whether the bill was delivered, and one verb: Open
   * Invoice. It used to carry the lines, the claim workbench, the balances, the applications, the
   * corrections and every money act, which made it a second, smaller invoice window that a reader
   * had to learn separately and that could disagree with the first.
   *
   * THREE FACES, ONE PANEL. Nothing selected, it speaks for the matter's billing position. One bill
   * selected, it shows that bill. Several selected, it counts them and offers nothing: there is no
   * bulk act on invoice evidence, and a panel that implied one would be lying.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import FileMinus from "@lucide/svelte/icons/file-minus";
  import Receipt from "@lucide/svelte/icons/receipt";
  import X from "@lucide/svelte/icons/x";
  import type { BillFigure } from "./bill-figures.ts";
  import {
    creditedMinor,
    deliveryReading,
    invoiceStanding,
    matterShareMinor,
    matterUnpaidMinor,
    overdueDays,
    type InvoiceRow,
  } from "./invoice-standing.ts";

  let {
    row,
    selectedCount,
    matterId,
    clientName,
    today,
    figures,
    money,
    onOpenInvoice,
    onLetGo,
  }: {
    /** The bill the panel speaks for, or null where nothing (or more than one) is selected. */
    row: InvoiceRow | null;
    selectedCount: number;
    matterId: string;
    clientName: string;
    today: string;
    /** The matter's own money figures, for the face the panel shows with nothing selected. */
    figures: readonly BillFigure[];
    money: (amountMinor: number) => string;
    onOpenInvoice: (row: InvoiceRow) => void;
    onLetGo: () => void;
  } = $props();

  const standing = $derived(row === null ? null : invoiceStanding(row));

  const heading = $derived.by((): string => {
    if (row === null) return "";
    if (row.summary.invoiceNumber !== null) return `Invoice ${row.summary.invoiceNumber}`;
    return row.summary.status === "draft" ? "Draft Bill" : "Voided Draft";
  });

  /** The chip is dropped exactly where it would say the same word the heading already says. */
  const chipAddsAFact = $derived.by((): boolean => {
    if (standing === null) return false;
    return !heading.toLowerCase().includes(statusEntry(standing).label.toLowerCase());
  });

  const credited = $derived(row === null ? 0 : creditedMinor(row));
  const share = $derived(row === null ? null : matterShareMinor(row, matterId));
  const owed = $derived(row === null ? null : matterUnpaidMinor(row, matterId));
  const late = $derived(row === null ? 0 : overdueDays(row, today));
  const delivered = $derived(
    row === null ? null : deliveryReading(row, (isoDate) => formatDate(isoDate)),
  );
</script>

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right tabular-nums" {title}>{value}</dd>
  </div>
{/snippet}

<aside
  class="flex h-full w-full flex-col border-l border-border-default bg-surface-default"
  aria-label="Bill details"
>
  {#if row !== null && standing !== null}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">{heading}</h2>
        <p class="text-xs text-text-muted">{clientName}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of this bill and show the matter's position"
        aria-label="Let go of this bill and show the matter's position"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <Button onclick={() => onOpenInvoice(row)}>
        <Receipt class="size-16" aria-hidden="true" />
        Open Invoice
      </Button>

      {#if chipAddsAFact || credited > 0}
        <div class="flex items-center gap-8">
          {#if chipAddsAFact}
            <Badge {...statusBadgeAttributes(standing)}>{statusEntry(standing).label}</Badge>
          {/if}
          {#if credited > 0}
            <FileMinus
              class="size-12 text-text-link"
              aria-label="Corrected by a credit note recorded beside it"
            />
          {/if}
        </div>
      {/if}

      <dl class="flex flex-col gap-4 border-t border-border-default pt-12 text-sm">
        {@render fact("Client", clientName)}
        {#if row.summary.issueDate !== null}
          {@render fact("Issued", formatDate(row.summary.issueDate))}
        {/if}
        {#if row.summary.dueDate !== null}
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Due</dt>
            <dd
              class="text-right tabular-nums {late > 0
                ? 'font-semibold text-status-danger-subtle-foreground'
                : ''}"
            >
              {formatDate(row.summary.dueDate)}{late > 0 ? ` · ${late} days past due` : ""}
            </dd>
          </div>
        {/if}
        {@render fact("This Matter", share === null ? "—" : money(share))}
        {#if owed !== null}
          {@render fact("Unpaid", money(owed))}
        {/if}
        {#if delivered !== null}
          {@render fact("Delivered", delivered.text, delivered.title)}
        {/if}
      </dl>
    </div>
  {:else if selectedCount > 1}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">{selectedCount} Bills Selected</h2>
        <p class="text-xs text-text-muted">Nothing here acts on more than one</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of all {selectedCount} selected bills"
        aria-label="Let go of all {selectedCount} selected bills"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <p class="text-sm text-text-muted">
        A bill is evidence: nothing here finalizes, credits or voids in bulk. Select one bill to open
        it.
      </p>
    </div>
  {:else}
    <header class="border-b border-border-default p-12">
      <h2 class="text-base leading-tight font-semibold">This Matter&rsquo;s Billing</h2>
      <p class="text-xs text-text-muted">Select a bill for its details</p>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <dl class="flex flex-col gap-4 text-sm">
        {#each figures as figure (figure.identifier)}
          {@render fact(
            figure.label.replace(/^./, (first) => first.toUpperCase()),
            money(figure.amountMinor),
            figure.caption,
          )}
        {/each}
      </dl>
      <p class="text-xs text-text-muted">
        An invoice belongs to one client and may bill several of that client&rsquo;s matters, so this
        register shows every bill of {clientName} and states this matter&rsquo;s own share of each.
      </p>
    </div>
  {/if}
</aside>

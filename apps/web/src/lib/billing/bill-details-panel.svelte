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
   * THREE FACES, ONE PANEL, over the shared shell ($lib/details-panel), which carries the frame, the
   * header grammar and the ruled runs of facts. Nothing selected, it speaks for the billing position.
   * One bill
   * selected, it shows that bill. Several selected, it counts them and offers nothing: there is no
   * bulk act on invoice evidence, and a panel that implied one would be lying.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import FileMinus from "@lucide/svelte/icons/file-minus";
  import Receipt from "@lucide/svelte/icons/receipt";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
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

<DetailsPanel.Root label="Bill details">
  {#if row !== null && standing !== null}
    <DetailsPanel.Header>
      <DetailsPanel.Title>{heading}</DetailsPanel.Title>
      <DetailsPanel.Subtitle>{clientName}</DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of this bill and show the matter's position"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>

    <DetailsPanel.Body>
      <Button onclick={() => onOpenInvoice(row)}>
        <Receipt class="size-16" aria-hidden="true" />
        Open Bill
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

      <DetailsPanel.Facts ruled>
        <DetailsPanel.Fact label="Client" value={clientName} />
        {#if row.summary.issueDate !== null}
          <DetailsPanel.Fact label="Issued" value={formatDate(row.summary.issueDate)} />
        {/if}
        {#if row.summary.dueDate !== null}
          <DetailsPanel.Fact
            label="Due"
            value={`${formatDate(row.summary.dueDate)}${late > 0 ? ` · ${late} days past due` : ""}`}
            valueClass={late > 0 ? "font-semibold text-status-danger-subtle-foreground" : ""}
          />
        {/if}
        <DetailsPanel.Fact label="This Matter" value={share === null ? "—" : money(share)} />
        {#if owed !== null}
          <DetailsPanel.Fact label="Unpaid" value={money(owed)} />
        {/if}
        {#if delivered !== null}
          <DetailsPanel.Fact label="Delivered" value={delivered.text} title={delivered.title} />
        {/if}
      </DetailsPanel.Facts>
    </DetailsPanel.Body>
  {:else if selectedCount > 1}
    <DetailsPanel.Header>
      <DetailsPanel.Title>{selectedCount} Bills Selected</DetailsPanel.Title>
      <DetailsPanel.Subtitle>Nothing here acts on more than one</DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of all {selectedCount} selected bills"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <p class="text-sm text-text-muted">
        A bill is evidence: nothing here finalizes, credits or voids in bulk. Select one bill to open
        it.
      </p>
    </DetailsPanel.Body>
  {:else}
    <DetailsPanel.Header>
      <DetailsPanel.Title>This Matter&rsquo;s Billing</DetailsPanel.Title>
      <DetailsPanel.Subtitle>Select a bill for its details</DetailsPanel.Subtitle>
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <DetailsPanel.Facts>
        {#each figures as figure (figure.identifier)}
          <DetailsPanel.Fact
            label={figure.label.replace(/^./, (first) => first.toUpperCase())}
            value={money(figure.amountMinor)}
            title={figure.caption}
          />
        {/each}
      </DetailsPanel.Facts>
      <p class="text-xs text-text-muted">
        A bill belongs to one client and can cover several of their matters. This list shows every bill for {clientName} and this matter&rsquo;s share of each.
      </p>
    </DetailsPanel.Body>
  {/if}
</DetailsPanel.Root>

<script lang="ts">
  /*
   * The fee ledger's details panel: what its three faces say, over the shared panel shell.
   *
   * The shell ($lib/details-panel) carries the frame, the header grammar and the ruled runs of
   * facts. What stays here is what only Fees knows: that a fee is named by its entry number with
   * its description underneath, that an incomplete fee says what it is missing, and that a fee
   * already on a finalized bill is evidence rather than something to correct in place.
   *
   * SEVERAL SELECTED OFFERS NOTHING, deliberately. No verb here acts on more than one fee, and a
   * face that implied otherwise would be lying; the row menu is where a selection is acted on.
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
  import * as DetailsPanel from "$lib/details-panel/index.ts";
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

<DetailsPanel.Root label="Fee details">
  {#if sole !== null}
    <DetailsPanel.Header>
      <DetailsPanel.Title title={entryNumberTitle(sole)}>{heading}</DetailsPanel.Title>
      <DetailsPanel.Subtitle>{sole.description}</DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of this fee and show the matter's position"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>

    <DetailsPanel.Body>
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

      <DetailsPanel.Facts ruled>
        <DetailsPanel.Fact label="Status">
          <Badge {...statusBadgeAttributes(feeStatusKey(sole.status))}>
            {statusEntry(feeStatusKey(sole.status)).label}
          </Badge>
        </DetailsPanel.Fact>
        <DetailsPanel.Fact label="Date" value={formatDate(sole.feeDate)} />
        <DetailsPanel.Fact label="Timekeeper" value={timekeeperText(sole)} />
        <DetailsPanel.Fact
          label="Amount"
          value={sole.amountMinor === null ? "Not recorded" : money(sole.amountMinor)}
        />
        <DetailsPanel.Fact
          label="Billing"
          value={sole.billable ? "Billable" : "Non-billable"}
          title={billingSentence(sole.billable)}
        />
        <DetailsPanel.Fact label="Attachments" value="—" title={gapCellTitle("attachments")} />
      </DetailsPanel.Facts>

      {#if sole.incomplete}
        <p class="text-xs text-status-warning-subtle-foreground">{incompleteNote(sole)}</p>
      {/if}
      {#if sole.invoiceNumber !== null}
        <p class="text-xs text-text-muted">
          Billed on <span class="tabular-nums">{sole.invoiceNumber}</span>. A record on a finalized
          bill is evidence; the correction is a credit note beside it.
        </p>
      {/if}
    </DetailsPanel.Body>
  {:else if selected.length > 1}
    <DetailsPanel.Header>
      <DetailsPanel.Title>{selected.length} Fees Selected</DetailsPanel.Title>
      <DetailsPanel.Subtitle>Nothing here acts on more than one</DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of all {selected.length} selected fees"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <p class="text-sm text-text-muted">
        Select one fee for its details. The row menu is where a verb acts on a whole selection.
      </p>
    </DetailsPanel.Body>
  {:else}
    <DetailsPanel.Header>
      <DetailsPanel.Title>This Matter&rsquo;s Fees</DetailsPanel.Title>
      <DetailsPanel.Subtitle>Select a fee for its details</DetailsPanel.Subtitle>
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <DetailsPanel.Facts>
        <DetailsPanel.Fact
          label="Fees"
          value={voided === 0
            ? String(live.length)
            : `${String(live.length)} (${String(voided)} void)`}
        />
        <DetailsPanel.Fact
          label="Unbilled"
          value={money(position.unbilledMinor)}
          title="Billable fees no finalized invoice has taken up. A draft bill claims them on the Billing tab."
        />
        <DetailsPanel.Fact
          label="Billed"
          value={money(position.billedMinor)}
          title="Fees a finalized invoice has taken up."
        />
      </DetailsPanel.Facts>
    </DetailsPanel.Body>
  {/if}
</DetailsPanel.Root>

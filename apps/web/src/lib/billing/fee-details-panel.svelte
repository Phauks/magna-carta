<script lang="ts">
  /*
   * The fee ledger's details panel: what its three faces say, over the shared panel shell.
   *
   * The shell ($lib/details-panel) carries the frame, the header grammar and the ruled runs of
   * facts. What stays here is what only Fees knows: that a fee is named by its entry number with
   * its description underneath, that a returned draft says why it came back, and that a fee
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
  import { billHref } from "$lib/money/index.ts";
  import {
    GONE_RECORDER_NOTE,
    recorderState,
    recorderText,
    returnedDraftReason,
  } from "$lib/records/work-in-progress-record.ts";
  import { FEE_LEDGER_GAPS, gapCellTitle } from "./fee-gaps.ts";
  import {
    billingSentence,
    countsInTotals,
    feePosition,
    feeStatusKey,
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

  const recorder = $derived(sole === null ? null : recorderState(sole));
</script>

<DetailsPanel.Root label="Fee details">
  {#if sole !== null}
    <DetailsPanel.Header>
      <DetailsPanel.Title>Fee</DetailsPanel.Title>
      <DetailsPanel.Subtitle title={gapCellTitle("entryNumber")}>
        {FEE_LEDGER_GAPS.entryNumber.field} not yet recorded
      </DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of this fee and show the matter's position"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>

    <DetailsPanel.Body>
      <p class="text-sm">{sole.description}</p>

      <!--
        A RETURNED DRAFT SAYS SO. A fee a reviewer sent back is the same status as one nobody has
        submitted and looks identical everywhere else, so without this the person who has to fix it
        is told only that it is a draft.
      -->
      {#if returnedDraftReason(sole) !== null}
        <p class="text-xs text-status-warning-subtle-foreground">
          Sent back for changes: {returnedDraftReason(sole)}
        </p>
      {/if}

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
        <DetailsPanel.Fact label="Date" value={formatDate(sole.serviceDate)} />
        <DetailsPanel.Fact label="Timekeeper" value={timekeeperText(sole)} />
        <DetailsPanel.Fact label="Amount" value={money(sole.amountMinor)} />
        <DetailsPanel.Fact
          label="Billing"
          value={sole.billable ? "Billable" : "Non-billable"}
          title={billingSentence(sole.billable)}
        />
        <DetailsPanel.Fact
          label="Entered By"
          value={recorderText(sole)}
          title={recorder?.kind === "gone" ? GONE_RECORDER_NOTE : undefined}
        />
        <DetailsPanel.Fact label="Attachments" value="—" title={gapCellTitle("attachments")} />
      </DetailsPanel.Facts>

      {#if sole.status === "billed"}
        <p class="text-xs text-text-muted">
          {#if sole.invoiceId === null}
            Billed. Which bill took it up is not recorded on this fee, so there is nothing to open
            from here.
          {:else}
            Billed. <a
              class="underline underline-offset-2"
              href={billHref(sole.matterId, sole.invoiceId)}>Open the bill this fee is on</a
            >. To correct a finalized bill, add a credit note.
          {/if}
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
        Select a fee to see its details. Use the row menu to act on several at once.
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
          title="Billable fees not yet on a finalized bill. Add them to a draft bill on the Billing tab."
        />
        <DetailsPanel.Fact
          label="Billed"
          value={money(position.billedMinor)}
          title="Fees on a finalized bill."
        />
      </DetailsPanel.Facts>
    </DetailsPanel.Body>
  {/if}
</DetailsPanel.Root>

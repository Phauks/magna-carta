<script lang="ts">
  /*
   * The time ledger's details panel: what its three faces say, over the shared panel shell.
   *
   * The shell ($lib/details-panel) carries the frame, the header grammar and the ruled sections —
   * the parts that used to be written out here and in three sibling files, and drifted between
   * them. What stays in this file is everything only Time knows: that an entry has a timekeeper
   * and a person who entered it and that both are always shown, that a charge of nothing says so
   * rather than reading as zero, and that a selection's amount excludes voids.
   *
   * THE PANEL OPENS A RECORD; IT DOES NOT EDIT ONE. Editing is the record window's own header
   * control, so there is exactly one place to reach for it — except printing from the list without
   * opening a record, which is a real convenience and keeps its icon here.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstantDate, personName } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Printer from "@lucide/svelte/icons/printer";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import { chargeAmount, durationParts, rateAmount, timekeeperOf, utbmsText } from "./time-columns.ts";
  import { matterTimeSummary, selectionSummary } from "./time-figures.ts";

  let {
    entries,
    selected,
    currency,
    onOpen,
    onPrint,
    onLetGo,
  }: {
    /** Every entry the matter carries, for the summary the panel gives when nothing is selected. */
    entries: readonly TimeEntrySummary[];
    /** What is selected right now, in the order the list holds it. */
    selected: readonly TimeEntrySummary[];
    currency: string;
    onOpen: (entry: TimeEntrySummary) => void;
    onPrint: (entry: TimeEntrySummary) => void;
    onLetGo: () => void;
  } = $props();

  const sole = $derived(selected.length === 1 ? (selected[0] ?? null) : null);
  const summary = $derived(matterTimeSummary(entries));
  const selection = $derived(selectionSummary(selected, (status) => statusEntry(status).label));

  /** Money in the matter's own currency. A charge of nothing says so rather than reading as zero. */
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });
  const chargeText = (entry: TimeEntrySummary): string => {
    const amount = chargeAmount(entry);
    return amount === null ? "No charge" : formatMoney(amount, { currency });
  };
</script>

<DetailsPanel.Root label="Entry details">
  {#if sole !== null}
    {@const worked = durationParts(sole.rawDurationMinutes)}
    {@const billed = durationParts(sole.durationMinutes)}
    <DetailsPanel.Header>
      <DetailsPanel.Title>Time Entry</DetailsPanel.Title>
      <DetailsPanel.Subtitle numeric>
        {sole.entryNumber ?? "No entry number"}
      </DetailsPanel.Subtitle>
      {#snippet actions()}
        <Button
          variant="ghost"
          size="icon"
          title="Print this entry by itself"
          aria-label="Print this entry by itself"
          onclick={() => onPrint(sole)}
        >
          <Printer class="size-16" aria-hidden="true" />
        </Button>
        <DetailsPanel.Close
          label="Let go of this entry and show the matter summary"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <p class="text-sm">{sole.narrative}</p>
      <Button class="self-start" onclick={() => onOpen(sole)}>
        <Maximize2 class="size-16" aria-hidden="true" />
        Open
      </Button>
      <DetailsPanel.Section label="Status">
        <div>
          <Badge {...statusBadgeAttributes(sole.status)}>{statusEntry(sole.status).label}</Badge>
        </div>
      </DetailsPanel.Section>
      <DetailsPanel.Facts ruled>
        <DetailsPanel.Fact label="Work Date" value={formatDate(sole.workDate)} />
        {#if sole.createdAt !== undefined}
          <DetailsPanel.Fact label="Date Entered" value={formatInstantDate(sole.createdAt)} />
        {/if}
        <DetailsPanel.Fact label="Timekeeper" value={timekeeperOf(sole)} />
        <!-- Both people, always: an entry a person recorded for themselves carries the same name
             twice, and delegation is the case where the two differ. -->
        <DetailsPanel.Fact label="Entered By" value={personName(sole.createdByName)} />
        {#if utbmsText(sole.utbmsTaskCode, sole.utbmsTaskLabel) !== ""}
          <DetailsPanel.Fact
            label="Category"
            value={utbmsText(sole.utbmsTaskCode, sole.utbmsTaskLabel)}
          />
        {/if}
        {#if utbmsText(sole.utbmsActivityCode, sole.utbmsActivityLabel) !== ""}
          <DetailsPanel.Fact
            label="Activity"
            value={utbmsText(sole.utbmsActivityCode, sole.utbmsActivityLabel)}
          />
        {/if}
        <DetailsPanel.Fact label="Billed" value={billed.text} />
        <DetailsPanel.Fact label="Worked" value={worked.text} />
        {#if rateAmount(sole) !== null}
          <DetailsPanel.Fact
            label="Rate"
            value={formatMoney(rateAmount(sole) ?? 0, { currency })}
          />
        {/if}
        <DetailsPanel.Fact label="Amount" value={chargeText(sole)} />
        <DetailsPanel.Fact
          label="Attachments"
          value={(sole.attachmentCount ?? 0) === 0 ? "None" : String(sole.attachmentCount)}
        />
      </DetailsPanel.Facts>
    </DetailsPanel.Body>
  {:else if selected.length > 1}
    <DetailsPanel.Header>
      <DetailsPanel.Title>{selection.count} Entries Selected</DetailsPanel.Title>
      <DetailsPanel.Subtitle>{selection.statusLine}</DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of all {selection.count} selected entries"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <DetailsPanel.Facts>
        <DetailsPanel.Fact
          label="Amount"
          value={selection.excludesVoids
            ? `${money(selection.amountMinor)} (voids excluded)`
            : money(selection.amountMinor)}
        />
      </DetailsPanel.Facts>
    </DetailsPanel.Body>
  {:else}
    <DetailsPanel.Header>
      <DetailsPanel.Title>This Matter&rsquo;s Time</DetailsPanel.Title>
      <DetailsPanel.Subtitle>Select an entry for its details</DetailsPanel.Subtitle>
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <DetailsPanel.Facts>
        <DetailsPanel.Fact
          label="Entries"
          value={summary.voidCount === 0
            ? String(summary.liveCount)
            : `${String(summary.liveCount)} (${String(summary.voidCount)} void)`}
        />
        <DetailsPanel.Fact label="Billed Hours" value={summary.billedHours} />
        <DetailsPanel.Fact label="Non-billable" value={summary.nonBillableHours} />
      </DetailsPanel.Facts>
      {#if summary.byTimekeeper.length > 0}
        <DetailsPanel.Section label="By Timekeeper">
          <DetailsPanel.Facts>
            {#each summary.byTimekeeper as share (share.name)}
              <DetailsPanel.Fact
                label={share.name}
                value={`${share.hours} · ${money(share.amountMinor)}`}
              />
            {/each}
          </DetailsPanel.Facts>
        </DetailsPanel.Section>
      {/if}
    </DetailsPanel.Body>
  {/if}
</DetailsPanel.Root>

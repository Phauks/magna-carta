<script lang="ts">
  /*
   * The details panel: the SMALLER altitude, beside the list.
   *
   * Three faces, one panel. Nothing selected, it speaks for the matter. One entry selected, it shows
   * that entry's identity, its standing and a few figures. Several selected, it speaks for the
   * selection and counts what a verb would act on.
   *
   * SELECTION IS NOT PRESENTATION. Clicking a row selects it and does nothing else; this panel opens
   * from its own control alone, and while it is open it follows whatever is selected. That is why
   * this file has no opener of its own — the surface owns whether the panel is showing.
   *
   * THE PANEL OPENS A RECORD; IT DOES NOT EDIT ONE. Editing and printing are the record window's own
   * header controls, so there is exactly one place to reach for either — except printing from the
   * list without opening a record, which is a real convenience and keeps its icon here.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { personName } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Printer from "@lucide/svelte/icons/printer";
  import X from "@lucide/svelte/icons/x";
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

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right tabular-nums" {title}>{value}</dd>
  </div>
{/snippet}

<aside
  class="flex h-full w-full flex-col border-l border-border-default bg-surface-default"
  aria-label="Entry details"
>
  {#if sole !== null}
    {@const worked = durationParts(sole.rawDurationMinutes)}
    {@const billed = durationParts(sole.durationMinutes)}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">Time Entry</h2>
        <p class="text-xs text-text-muted tabular-nums">
          {sole.entryNumber ?? "No entry number"}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Print this entry by itself"
        aria-label="Print this entry by itself"
        onclick={() => onPrint(sole)}
      >
        <Printer class="size-16" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of this entry and show the matter summary"
        aria-label="Let go of this entry and show the matter summary"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <p class="text-sm">{sole.narrative}</p>
      <Button class="self-start" onclick={() => onOpen(sole)}>
        <Maximize2 class="size-16" aria-hidden="true" />
        Open
      </Button>
      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <FieldLabel as="h3">Status</FieldLabel>
        <div>
          <Badge {...statusBadgeAttributes(sole.status)}>{statusEntry(sole.status).label}</Badge>
        </div>
      </section>
      <dl class="flex flex-col gap-4 border-t border-border-default pt-12 text-sm">
        {@render fact("Work Date", formatDate(sole.workDate))}
        {#if sole.createdAt !== undefined}
          {@render fact("Date Entered", formatDate(sole.createdAt.slice(0, 10)))}
        {/if}
        {@render fact("Timekeeper", timekeeperOf(sole))}
        <!-- Both people, always: an entry a person recorded for themselves carries the same name
             twice, and delegation is the case where the two differ. -->
        {@render fact("Entered By", personName(sole.createdByName))}
        {#if utbmsText(sole.utbmsTaskCode, sole.utbmsTaskLabel) !== ""}
          {@render fact("Category", utbmsText(sole.utbmsTaskCode, sole.utbmsTaskLabel))}
        {/if}
        {#if utbmsText(sole.utbmsActivityCode, sole.utbmsActivityLabel) !== ""}
          {@render fact("Activity", utbmsText(sole.utbmsActivityCode, sole.utbmsActivityLabel))}
        {/if}
        {@render fact("Billed", billed.text)}
        {@render fact("Worked", worked.text)}
        {#if rateAmount(sole) !== null}
          {@render fact("Rate", formatMoney(rateAmount(sole) ?? 0, { currency }))}
        {/if}
        {@render fact("Amount", chargeText(sole))}
        {@render fact(
          "Attachments",
          (sole.attachmentCount ?? 0) === 0 ? "None" : String(sole.attachmentCount),
        )}
      </dl>
    </div>
  {:else if selected.length > 1}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-tight font-semibold">
          {selection.count} Entries Selected
        </h2>
        <p class="text-xs text-text-muted">{selection.statusLine}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Let go of all {selection.count} selected entries"
        aria-label="Let go of all {selection.count} selected entries"
        onclick={onLetGo}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact(
          "Amount",
          selection.excludesVoids
            ? `${money(selection.amountMinor)} (voids excluded)`
            : money(selection.amountMinor),
        )}
      </dl>
    </div>
  {:else}
    <header class="border-b border-border-default p-12">
      <h2 class="text-base leading-tight font-semibold">This Matter&rsquo;s Time</h2>
      <p class="text-xs text-text-muted">Select an entry for its details</p>
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16">
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact(
          "Entries",
          summary.voidCount === 0
            ? String(summary.liveCount)
            : `${String(summary.liveCount)} (${String(summary.voidCount)} void)`,
        )}
        {@render fact("Billed Hours", summary.billedHours)}
        {@render fact("Non-billable", summary.nonBillableHours)}
      </dl>
      {#if summary.byTimekeeper.length > 0}
        <section class="flex flex-col gap-8 border-t border-border-default pt-12">
          <FieldLabel as="h3">By Timekeeper</FieldLabel>
          <dl class="flex flex-col gap-4 text-sm">
            {#each summary.byTimekeeper as share (share.name)}
              {@render fact(share.name, `${share.hours} · ${money(share.amountMinor)}`)}
            {/each}
          </dl>
        </section>
      {/if}
    </div>
  {/if}
</aside>

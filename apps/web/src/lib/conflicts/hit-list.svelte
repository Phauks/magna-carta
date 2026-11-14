<script lang="ts">
  /*
   * What a check surfaced, on the platform's one table — so sorting, the per-column filters, column
   * show/hide, reorder, pinning, resize and the counts footer are the same machinery a docket or a
   * timesheet uses. A reviewer triaging a wide check needs exactly those, and none of them belongs
   * to this surface.
   *
   * NOTHING IS EVER HIDDEN FROM THE READER BY THIS COMPONENT. The engine suppresses no candidate by
   * tier, and neither does the list: the filters narrow what a reviewer is LOOKING at, the footer
   * says how many rows that leaves out of how many, and clearing them brings everything back.
   *
   * Opening a row is a deliberate act (double-click or Enter), because opening a hit spends a read
   * naming its party — the check answers handles and nothing names many at once.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import { MaturityBadge } from "@magna-carta/design-system/maturity";
  import type { HitDetail } from "./conflicts-api.ts";
  import {
    adjudicationSummary,
    evidenceTier,
    sourceVocabulary,
  } from "./conflicts-vocabulary.ts";
  import {
    HIT_COLUMN_IDENTIFIERS,
    HIT_INITIAL_SORT,
    hitColumns,
    partyCellTitle,
    partyText,
  } from "./hit-columns.ts";

  let {
    hits,
    loading = false,
    onOpen,
  }: {
    /** The check's candidates. Null while the check is being read. */
    hits: readonly HitDetail[] | null;
    loading?: boolean;
    onOpen: (hit: HitDetail) => void;
  } = $props();

  const grid = DataTable.createDataTableGrid<HitDetail>({
    columns: () => hitColumns(),
    rows: () => hits ?? [],
    rowKey: (hit) => hit.id,
    initialSort: HIT_INITIAL_SORT,
    itemNoun: { singular: "candidate", plural: "candidates" },
    // Wrapped rather than handed over directly: the option is captured once, and a bare reference
    // would pin the first `onOpen` this component ever saw.
    onActivate: (hit) => onOpen(hit),
  });
</script>

{#snippet hitCell({ row, column, text }: DataTable.GridCellContext<HitDetail>)}
  {#if column.id === HIT_COLUMN_IDENTIFIERS.tier}
    {@const tier = evidenceTier(row.evidenceTier)}
    <span class="tabular-nums" title={tier.meaning}>{tier.label}</span>
  {:else if column.id === HIT_COLUMN_IDENTIFIERS.party}
    <!-- Named, or told why not. An unresolved entity and an unnamed record are different facts and
         both are stated; neither renders blank, which would read as a hit with no party. -->
    {@const title = partyCellTitle(row)}
    <span class={row.party?.displayName == null ? "text-text-muted" : undefined} {title}>
      {partyText(row)}
    </span>
  {:else if column.id === HIT_COLUMN_IDENTIFIERS.source}
    {@const source = sourceVocabulary(row.sourceClass)}
    <span title={source.meaning}>{source.label}</span>
  {:else if column.id === HIT_COLUMN_IDENTIFIERS.adjudication}
    <!-- A waiver whose record the platform cannot produce wears the open-question tone and says so
         in words. It must never look like one the firm could hand over on demand. -->
    {@const chip = adjudicationSummary(row.disposition)}
    <Badge variant={chip.tone} title={chip.meaning}>{chip.label}</Badge>
  {:else if text === ""}
    <span class="text-text-muted">&mdash;</span>
  {:else}
    {text}
  {/if}
{/snippet}

<section class="flex flex-col gap-16">
  <div class="flex flex-wrap items-center gap-8">
    <h2 class="text-base font-semibold">Candidates</h2>
    <MaturityBadge stage="soon" />
  </div>

  <DataTable.Grid {grid} caption="What this check found" cell={hitCell} {loading}>
  </DataTable.Grid>

  <DataTable.GridFooter {grid} />
</section>

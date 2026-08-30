<script lang="ts" generics="TRow">
  /*
   * DataTable.GridColumnFilter — the in-header filter for one grid column: the funnel that lives
   * INSIDE the header cell (flush at its end edge, one hover unit with the label, space always
   * reserved — the head recipe owns that geometry), opening the ONE filter mechanism parameterized
   * by the column's type: contains-text, a checkbox set with counts, a numeric from/to range with
   * its honest unit note, or a date from/to range. A filtered column's funnel is apparent
   * (accent-subtle fill), and the clear affordance exists ONLY while the filter is in play —
   * absence is the signal.
   *
   * Three settled rules shape the set filter in particular, and each was violated once already:
   *   - Every ghost text is the FIELD'S NAME, never a description of what to do. The narrow field
   *     and the contains field both carry the column's own label; a range's two fields carry
   *     "From" and "To", which are their names.
   *   - The select-all/none affordance is ONE reactive control that says what pressing it will
   *     DO: everything on reads "Select none", anything off reads "Select all".
   *   - A set filter with everything selected IS no filter, so a set filter carries NO clear
   *     control at all — the one reactive control already says the same thing.
   */
  import Funnel from "@lucide/svelte/icons/funnel";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import * as Popover from "../popover/index.ts";
  import Input from "../input/index.ts";
  import Checkbox from "../checkbox/index.ts";
  import Button from "../button/index.ts";
  import type { GridColumn } from "./grid-columns.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";
  import { gridColumnFilterKind, gridFilterSummary } from "./grid-filters.ts";
  import {
    facetSelectionAfterToggle,
    facetSelectionAfterToggleAll,
    isAllFacetsSelected,
    isFacetSelected,
    type FacetSelection,
  } from "./facet-selection.ts";

  type Props = { grid: DataTableGridState<TRow>; column: GridColumn<TRow> };
  let { grid, column }: Props = $props();

  const kind = $derived(gridColumnFilterKind(column));
  const filter = $derived(grid.filterFor(column.id));
  const active = $derived(filter !== undefined);
  const title = $derived(
    filter === undefined
      ? `Filter ${column.label}`
      : `Filtered: ${gridFilterSummary(column, filter)}. Change or clear the filter`,
  );

  let setQuery = $state("");

  // The set filter's stable universe (all rows, never the filtered view) with per-value counts.
  const setCounts = $derived(kind === "set" ? grid.setFilterCounts(column.id) : new Map());
  const setUniverse = $derived([...setCounts.keys()]);
  const setSelection = (): FacetSelection =>
    grid.filterFor(column.id)?.kind === "set"
      ? (grid.filterFor(column.id) as { values: readonly string[] }).values
      : undefined;
  const visibleSetValues = $derived.by((): string[] => {
    const query = setQuery.trim().toLowerCase();
    return query === ""
      ? setUniverse
      : setUniverse.filter((value) => value.toLowerCase().includes(query));
  });
  function applySetSelection(selection: FacetSelection): void {
    if (selection === undefined) grid.clearFilter(column.id);
    else grid.setFilter(column.id, { kind: "set", values: selection });
  }

  // ONE control, reading the current state and naming the act it performs.
  const everythingSelected = $derived(isAllFacetsSelected(setUniverse, setSelection()));
  const selectAllLabel = $derived(everythingSelected ? "Select none" : "Select all");
  const selectAllTitle = $derived(
    everythingSelected
      ? "Uncheck every choice; the list empties until something is chosen"
      : "Check every choice: everything selected is no filter at all",
  );

  const textQuery = (): string => {
    const current = grid.filterFor(column.id);
    return current?.kind === "text" ? current.query : "";
  };

  const rangeBound = (side: "from" | "to"): string => {
    const current = grid.filterFor(column.id);
    if (current?.kind !== "range") return "";
    const bound = current[side];
    return bound === null ? "" : String(bound);
  };
  function setRangeBound(side: "from" | "to", raw: string): void {
    const current = grid.filterFor(column.id);
    const next = {
      kind: "range" as const,
      from: current?.kind === "range" ? current.from : null,
      to: current?.kind === "range" ? current.to : null,
    };
    next[side] = raw === "" ? null : Number(raw);
    grid.setFilter(column.id, next);
  }

  const dateBound = (side: "from" | "to"): string => {
    const current = grid.filterFor(column.id);
    if (current?.kind !== "dateRange") return "";
    return current[side] ?? "";
  };
  function setDateBound(side: "from" | "to", raw: string): void {
    const current = grid.filterFor(column.id);
    const next = {
      kind: "dateRange" as const,
      from: current?.kind === "dateRange" ? current.from : null,
      to: current?.kind === "dateRange" ? current.to : null,
    };
    next[side] = raw === "" ? null : raw;
    grid.setFilter(column.id, next);
  }
</script>

{#if kind !== "none"}
  <Popover.Root onOpenChange={() => (setQuery = "")}>
    <Popover.Trigger
      class="mc-table-grid-filter-trigger"
      data-active={active ? "true" : undefined}
      aria-label={title}
      {title}
    >
      <Funnel class="mc-table-filter-icon" aria-hidden="true" />
    </Popover.Trigger>
    <Popover.Content align="start" class="mc-table-filter-content">
      <p class="mc-table-filter-heading">Filter {column.label}</p>

      {#if kind === "text"}
        <Input
          type="search"
          size="sm"
          placeholder={column.label}
          aria-label="Filter {column.label}"
          value={textQuery()}
          oninput={(event) =>
            grid.setFilter(column.id, { kind: "text", query: event.currentTarget.value })}
        />
      {:else if kind === "set"}
        <Input
          type="search"
          size="sm"
          placeholder={column.label}
          aria-label="Narrow the {column.label} choices"
          bind:value={setQuery}
        />
        <div class="mc-table-filter-selectall">
          <button
            type="button"
            class="mc-table-filter-selectall-toggle"
            title={selectAllTitle}
            onclick={() => applySetSelection(facetSelectionAfterToggleAll(!everythingSelected))}
          >
            {selectAllLabel}
          </button>
        </div>
        <div class="mc-table-filter-facets mc-scrollbar">
          {#each visibleSetValues as value (value)}
            <label class="mc-table-filter-option">
              <Checkbox
                bind:checked={
                  () => isFacetSelected(setSelection(), value),
                  (checked) =>
                    applySetSelection(
                      facetSelectionAfterToggle(setUniverse, setSelection(), value, checked),
                    )
                }
                aria-label={value === "" ? "(empty)" : value}
              />
              <span>{value === "" ? "(empty)" : value}</span>
              <span class="mc-table-filter-count">{setCounts.get(value)}</span>
            </label>
          {/each}
        </div>
      {:else if kind === "range"}
        <div class="mc-table-filter-range-row">
          <Input
            type="number"
            size="sm"
            placeholder="From"
            aria-label="From"
            value={rangeBound("from")}
            oninput={(event) => setRangeBound("from", event.currentTarget.value)}
          />
          <span class="mc-table-filter-note">to</span>
          <Input
            type="number"
            size="sm"
            placeholder="To"
            aria-label="To"
            value={rangeBound("to")}
            oninput={(event) => setRangeBound("to", event.currentTarget.value)}
          />
        </div>
        {#if column.filterNote}
          <p class="mc-table-filter-note">{column.filterNote}</p>
        {/if}
      {:else if kind === "dateRange"}
        <div class="mc-table-filter-range-row">
          <Input
            type="date"
            size="sm"
            aria-label="From"
            value={dateBound("from")}
            oninput={(event) => setDateBound("from", event.currentTarget.value)}
          />
          <span class="mc-table-filter-note">to</span>
          <Input
            type="date"
            size="sm"
            aria-label="To"
            value={dateBound("to")}
            oninput={(event) => setDateBound("to", event.currentTarget.value)}
          />
        </div>
        {#if column.filterNote}
          <p class="mc-table-filter-note">{column.filterNote}</p>
        {/if}
      {/if}

      {#if active && kind !== "set"}
        <div class="mc-table-filter-actions">
          <Button
            variant="ghost"
            size="sm"
            title="Stop filtering by {column.label}"
            onclick={() => grid.clearFilter(column.id)}
          >
            <FunnelX class="mc-table-filter-icon" aria-hidden="true" />
            Clear This Filter
          </Button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}

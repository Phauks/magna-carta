<script lang="ts" generics="TData">
  /*
   * DataTable.ColumnFilter — a per-column filter in the spirit of Excel / Google Sheets: a small
   * funnel in the header opens a popover with the control that fits the column's type (from meta) —
   * a contains box (text), a searchable checklist of distinct values (facet, the Sheets pattern:
   * everything is checked until you uncheck), a min/max pair (number/money range), or quick presets
   * (date). The funnel lights up while the column is filtered; each popover has a Clear action.
   *
   * Facets use a STABLE universe (the column's distinct values over the unfiltered rows, via `table`)
   * and the `facet-selection` model with `facetFilterFn`, so "deselect everything" means NONE and the
   * list never collapses. Checkboxes are bound with get/set function bindings (the Bits-UI controlled
   * pattern), so what's shown always reflects the table state — never a stale internal toggle.
   *
   * The date control offers quick presets, not a nested calendar: a calendar popover nested inside
   * this filter popover crashes the floating layer, and presets are the better fit for column filters.
   */
  import type { Column, Table } from "@tanstack/table-core";
  import { getLocalTimeZone, today } from "@internationalized/date";
  import Funnel from "@lucide/svelte/icons/funnel";
  import * as Popover from "../popover/index.ts";
  import Input from "../input/index.ts";
  import Checkbox from "../checkbox/index.ts";
  import Button from "../button/index.ts";
  import { columnFilterKind, columnLabel } from "./typed-columns.ts";
  import {
    facetSelectionAfterToggle,
    facetSelectionAfterToggleAll,
    isAllFacetsSelected,
    isFacetSelected,
    isSomeFacetsSelected,
    type FacetSelection,
  } from "./facet-selection.ts";
  import {
    activeDateRangePresetId,
    DATE_RANGE_PRESETS,
    presetFilterValue,
    type DateRangePreset,
  } from "./date-range-presets.ts";

  type Props = { column: Column<TData>; table: Table<TData> };
  let { column, table }: Props = $props();

  const kind = $derived(columnFilterKind(column as Column<TData, unknown>));
  const name = $derived(columnLabel(column as Column<TData, unknown>));

  let facetQuery = $state("");

  // The column's full, STABLE set of distinct values, from the unfiltered (core) rows — so options
  // never vanish as the selection narrows and the all/none math never divides by an empty set.
  function facetUniverse(): string[] {
    const values = new Set<string>();
    for (const row of table.getCoreRowModel().rows) {
      const value = row.getValue(column.id);
      if (value != null) values.add(String(value));
    }
    return [...values].sort();
  }
  const facetSelection = (): FacetSelection => column.getFilterValue() as FacetSelection;
  const visibleFacets = (universe: string[]): string[] => {
    const query = facetQuery.trim().toLowerCase();
    return query === "" ? universe : universe.filter((value) => value.toLowerCase().includes(query));
  };

  // Numeric range pair (min/max).
  const pair = (): [string, string] => {
    const [low, high] = (column.getFilterValue() as [unknown, unknown] | undefined) ?? [];
    return [low == null ? "" : String(low), high == null ? "" : String(high)];
  };
  function setBound(index: 0 | 1, raw: string): void {
    const current = ((column.getFilterValue() as [number?, number?] | undefined)?.slice() ?? [
      undefined,
      undefined,
    ]) as [number?, number?];
    current[index] = raw === "" ? undefined : Number(raw);
    column.setFilterValue(current[0] == null && current[1] == null ? undefined : current);
  }

  // Date — quick presets stored as the [from, to] pair of YYYY-MM-DD strings that dateRangeFilterFn
  // reads; the active preset (if any) is highlighted.
  const dateValue = (): [string?, string?] | undefined =>
    column.getFilterValue() as [string?, string?] | undefined;
  const activePreset = (): string | undefined =>
    activeDateRangePresetId(dateValue(), today(getLocalTimeZone()));
  function applyPreset(preset: DateRangePreset): void {
    column.setFilterValue(presetFilterValue(preset, today(getLocalTimeZone())));
  }
</script>

{#if kind}
  <Popover.Root onOpenChange={() => (facetQuery = "")}>
    <Popover.Trigger
      class="mc-table-filter-trigger"
      data-active={column.getIsFiltered() ? "true" : undefined}
      aria-label="Filter {name}"
    >
      <Funnel class="mc-table-filter-icon" aria-hidden="true" />
    </Popover.Trigger>
    <Popover.Content align="start" class="mc-table-filter-content">
      <p class="mc-table-filter-heading">{name}</p>

      {#if kind === "text"}
        <Input
          type="search"
          placeholder="Contains…"
          aria-label="Filter {name}"
          value={(column.getFilterValue() as string) ?? ""}
          oninput={(event) => column.setFilterValue(event.currentTarget.value || undefined)}
        />
      {:else if kind === "facet"}
        {@const universe = facetUniverse()}
        <Input
          type="search"
          placeholder="Search values…"
          aria-label="Search values"
          bind:value={facetQuery}
        />
        <label class="mc-table-filter-option mc-table-filter-selectall">
          <Checkbox
            bind:checked={
              () => isAllFacetsSelected(universe, facetSelection()),
              (checked) => column.setFilterValue(facetSelectionAfterToggleAll(checked))
            }
            indeterminate={isSomeFacetsSelected(universe, facetSelection())}
            aria-label="Select all"
          />
          <span>Select all</span>
        </label>
        <div class="mc-table-filter-facets mc-scrollbar">
          {#each visibleFacets(universe) as value (value)}
            <label class="mc-table-filter-option">
              <Checkbox
                bind:checked={
                  () => isFacetSelected(facetSelection(), value),
                  (checked) =>
                    column.setFilterValue(
                      facetSelectionAfterToggle(universe, facetSelection(), value, checked),
                    )
                }
                aria-label={value}
              />
              <span>{value}</span>
            </label>
          {/each}
        </div>
      {:else if kind === "range"}
        <label class="mc-table-filter-field">
          <span class="mc-table-filter-field-label">Min</span>
          <Input
            type="number"
            aria-label="Minimum"
            value={pair()[0]}
            oninput={(event) => setBound(0, event.currentTarget.value)}
          />
        </label>
        <label class="mc-table-filter-field">
          <span class="mc-table-filter-field-label">Max</span>
          <Input
            type="number"
            aria-label="Maximum"
            value={pair()[1]}
            oninput={(event) => setBound(1, event.currentTarget.value)}
          />
        </label>
      {:else if kind === "date"}
        <div class="mc-table-filter-presets">
          {#each DATE_RANGE_PRESETS as preset (preset.id)}
            <Button
              variant={activePreset() === preset.id ? "secondary" : "ghost"}
              size="sm"
              class="mc-table-filter-preset"
              onclick={() => applyPreset(preset)}
            >
              {preset.label}
            </Button>
          {/each}
        </div>
      {/if}

      {#if column.getIsFiltered()}
        <div class="mc-table-filter-actions">
          <Button variant="ghost" size="sm" onclick={() => column.setFilterValue(undefined)}>
            Clear
          </Button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}

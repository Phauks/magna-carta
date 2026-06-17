<script lang="ts" generics="TData">
  /*
   * DataTable.ColumnFilter — a per-column filter: a funnel button in the header opens a popover with
   * the control that fits the column's type (from meta) — a contains box (text), a faceted list of
   * distinct values (facet), a min/max pair (range, for number/money), or a from/to pair (date). The
   * funnel highlights while the column is filtered. Drives the column's filter value on the shared
   * table; the column's filterFn must match the kind (includesString / arrIncludesSome / inNumberRange
   * / dateRangeFilterFn) — set it on the column definition.
   */
  import type { Column } from "@tanstack/table-core";
  import Funnel from "@lucide/svelte/icons/funnel";
  import * as Popover from "../popover/index.ts";
  import Input from "../input/index.ts";
  import Checkbox from "../checkbox/index.ts";
  import Button from "../button/index.ts";
  import { columnFilterKind, columnLabel } from "./typed-columns.ts";

  type Props = { column: Column<TData> };
  let { column }: Props = $props();

  const kind = $derived(columnFilterKind(column as Column<TData, unknown>));
  const name = $derived(columnLabel(column as Column<TData, unknown>));

  const facetValues = (): string[] =>
    [...(column.getFacetedUniqueValues()?.keys() ?? [])].map((value) => String(value)).sort();
  const selectedFacets = (): string[] => (column.getFilterValue() as string[] | undefined) ?? [];
  function toggleFacet(value: string, on: boolean): void {
    const next = new Set(selectedFacets());
    if (on) next.add(value);
    else next.delete(value);
    column.setFilterValue(next.size ? [...next] : undefined);
  }

  const pair = (): [string, string] => {
    const [low, high] = (column.getFilterValue() as [unknown, unknown] | undefined) ?? [];
    return [low == null ? "" : String(low), high == null ? "" : String(high)];
  };
  function setRange(index: 0 | 1, raw: string): void {
    const current = ((column.getFilterValue() as [number?, number?] | undefined)?.slice() ?? [
      undefined,
      undefined,
    ]) as [number?, number?];
    current[index] = raw === "" ? undefined : Number(raw);
    column.setFilterValue(current[0] == null && current[1] == null ? undefined : current);
  }
  function setDate(index: 0 | 1, raw: string): void {
    const current = ((column.getFilterValue() as [string?, string?] | undefined)?.slice() ?? [
      undefined,
      undefined,
    ]) as [string?, string?];
    current[index] = raw || undefined;
    column.setFilterValue(!current[0] && !current[1] ? undefined : current);
  }
</script>

{#if kind}
  <Popover.Root>
    <Popover.Trigger
      class="mc-table-filter-trigger"
      data-active={column.getIsFiltered() ? "true" : undefined}
      aria-label="Filter {name}"
    >
      <Funnel class="mc-table-filter-icon" aria-hidden="true" />
    </Popover.Trigger>
    <Popover.Content align="start" class="mc-table-filter-content">
      {#if kind === "text"}
        <Input
          type="search"
          placeholder="Contains…"
          aria-label="Filter {name}"
          value={(column.getFilterValue() as string) ?? ""}
          oninput={(event) => column.setFilterValue(event.currentTarget.value || undefined)}
        />
      {:else if kind === "facet"}
        <div class="mc-table-filter-facets mc-scrollbar">
          {#each facetValues() as value (value)}
            <label class="mc-table-filter-option">
              <Checkbox
                checked={selectedFacets().includes(value)}
                onCheckedChange={(checked) => toggleFacet(value, checked === true)}
                aria-label={value}
              />
              <span>{value}</span>
            </label>
          {/each}
        </div>
      {:else if kind === "range"}
        <div class="mc-table-filter-row">
          <Input
            type="number"
            placeholder="Min"
            aria-label="Minimum"
            value={pair()[0]}
            oninput={(event) => setRange(0, event.currentTarget.value)}
          />
          <Input
            type="number"
            placeholder="Max"
            aria-label="Maximum"
            value={pair()[1]}
            oninput={(event) => setRange(1, event.currentTarget.value)}
          />
        </div>
      {:else if kind === "date"}
        <div class="mc-table-filter-row">
          <Input
            type="date"
            aria-label="From"
            value={pair()[0]}
            oninput={(event) => setDate(0, event.currentTarget.value)}
          />
          <Input
            type="date"
            aria-label="To"
            value={pair()[1]}
            oninput={(event) => setDate(1, event.currentTarget.value)}
          />
        </div>
      {/if}
      {#if column.getIsFiltered()}
        <Button variant="ghost" size="sm" onclick={() => column.setFilterValue(undefined)}>
          Clear
        </Button>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}

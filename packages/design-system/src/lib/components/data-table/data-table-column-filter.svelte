<script lang="ts" generics="TData">
  /*
   * DataTable.ColumnFilter — a per-column filter in the spirit of Excel / Google Sheets: a small
   * funnel in the header opens a popover with the control that fits the column's type (from meta) —
   * a contains box (text), a searchable checklist of distinct values (facet, the Sheets pattern:
   * everything is checked until you uncheck), a min/max pair (number/money range), or a from/to pair
   * (date). The funnel lights up while the column is filtered; each popover has a Clear action. The
   * column declares the matching filterFn (includesString / arrIncludesSome / inNumberRange /
   * dateRangeFilterFn).
   */
  import type { Column } from "@tanstack/table-core";
  import type { DateRange } from "bits-ui";
  import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
  import Funnel from "@lucide/svelte/icons/funnel";
  import * as Popover from "../popover/index.ts";
  import Input from "../input/index.ts";
  import Checkbox from "../checkbox/index.ts";
  import Button from "../button/index.ts";
  import { DateRangePicker } from "../date-range-picker/index.ts";
  import { columnFilterKind, columnLabel } from "./typed-columns.ts";

  type Props = { column: Column<TData> };
  let { column }: Props = $props();

  const kind = $derived(columnFilterKind(column as Column<TData, unknown>));
  const name = $derived(columnLabel(column as Column<TData, unknown>));

  let facetQuery = $state("");

  // Faceted (Sheets-style) selection: no filter value means "all checked". Unchecking a value filters
  // to the remaining set; re-selecting them all clears the filter.
  const allFacets = (): string[] =>
    [...(column.getFacetedUniqueValues()?.keys() ?? [])].map((value) => String(value)).sort();
  const visibleFacets = (): string[] =>
    allFacets().filter((value) => value.toLowerCase().includes(facetQuery.trim().toLowerCase()));
  const checkedFacets = (): string[] | undefined => column.getFilterValue() as string[] | undefined;
  const isFacetChecked = (value: string): boolean =>
    checkedFacets() === undefined || checkedFacets()!.includes(value);
  const allChecked = (): boolean => {
    const checked = checkedFacets();
    return checked === undefined || checked.length === allFacets().length;
  };
  const someChecked = (): boolean => {
    const checked = checkedFacets();
    return checked !== undefined && checked.length > 0 && checked.length < allFacets().length;
  };
  function toggleFacet(value: string, on: boolean): void {
    const all = allFacets();
    const set = new Set(checkedFacets() ?? all);
    if (on) set.add(value);
    else set.delete(value);
    column.setFilterValue(set.size === all.length ? undefined : [...set]);
  }
  function toggleAll(on: boolean): void {
    column.setFilterValue(on ? undefined : []);
  }

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

  // Date range — the filter value is a [from, to] pair of YYYY-MM-DD strings (so the filterFn stays
  // plain), but the UI is the styled DateRangePicker (CalendarDate), not a native date input.
  const dateFilter = (): DateRange | undefined => {
    const [from, to] = (column.getFilterValue() as [string?, string?] | undefined) ?? [];
    return from || to
      ? { start: from ? parseDate(from) : undefined, end: to ? parseDate(to) : undefined }
      : undefined;
  };
  function setDateRange(range: DateRange | undefined): void {
    const from = range?.start?.toString();
    const to = range?.end?.toString();
    column.setFilterValue(from || to ? [from, to] : undefined);
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
        <Input type="search" placeholder="Search values…" aria-label="Search values" bind:value={facetQuery} />
        <label class="mc-table-filter-option mc-table-filter-selectall">
          <Checkbox
            checked={allChecked()}
            indeterminate={someChecked()}
            onCheckedChange={(checked) => toggleAll(checked === true)}
            aria-label="Select all"
          />
          <span>Select all</span>
        </label>
        <div class="mc-table-filter-facets mc-scrollbar">
          {#each visibleFacets() as value (value)}
            <label class="mc-table-filter-option">
              <Checkbox
                checked={isFacetChecked(value)}
                onCheckedChange={(checked) => toggleFacet(value, checked === true)}
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
        <DateRangePicker
          value={dateFilter()}
          onValueChange={(range) => setDateRange(range)}
          placeholder={today(getLocalTimeZone())}
          aria-label="Filter {name} range"
        />
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

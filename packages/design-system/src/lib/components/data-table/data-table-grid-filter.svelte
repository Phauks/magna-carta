<script lang="ts" generics="TRow">
  /*
   * DataTable.GridColumnFilter — one column's filter, as a submenu of the header's own menu
   * (GridHeadMenu). It is not a control on the table: the header cell shows only whether a filter
   * is IN PLAY, and everything that sets one is summoned by right-clicking the column, in the same
   * menu as hiding, pinning and the roster. One gesture reaches everything a column can be asked.
   *
   * What opens is the ONE filter mechanism parameterized by the column's type: a checkbox set with
   * counts (what a text column gets), a numeric from/to range with its honest unit note, a date
   * from/to range, or — for the prose column that declares it — a contains-text box. The clear
   * affordance exists ONLY while the filter is in play — absence is the signal.
   *
   * Four settled rules shape the set filter in particular, and each was violated once already:
   *   - A filter is CHOSEN FROM WHAT THE COLUMN HOLDS. The set lists every value the rows carry,
   *     each with its count, so a reader has a baseline to choose from. A box that matches typed
   *     text offers no such baseline — it is a search wearing a filter's name, and the table has a
   *     search — so it is kept only for prose, where no two rows share a value.
   *   - Every ghost text is the FIELD'S NAME, never a description of what to do. The narrow field
   *     and the contains field both carry the column's own label; a range's two fields carry
   *     "From" and "To", which are their names. The DATE range has no ghost text to carry one —
   *     a segmented field shows its own parts — so From and To are its aria-labels instead, which
   *     is the same rule reaching the same place by the only route open to it.
   *   - The select-all/none affordance is ONE reactive control that says what pressing it will
   *     DO, and it acts on the choices LISTED: with the list whole, everything on reads "Select
   *     none" and anything off reads "Select all"; with the list narrowed by the field above it,
   *     the same control reads "Select all listed" or "Select none listed" and touches only those,
   *     which is how a column of hundreds of names is narrowed to the dozen that match a word.
   *   - A set filter with everything selected IS no filter, so a set filter carries NO clear
   *     control at all — the one reactive control already says the same thing.
   *
   * The date range's calendar is a popover portaled outside this submenu, and the submenu stays
   * open while the calendar holds focus (context-menu/menu-field-layer.ts); without that, reaching
   * for the calendar closed the submenu and unmounted the field that opened it.
   */
  import Funnel from "@lucide/svelte/icons/funnel";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import * as ContextMenu from "../context-menu/index.ts";
  import { keepMenuFieldKeys } from "../context-menu/menu-field-keys.ts";
  import Input from "../input/index.ts";
  import {
    civilDateTextOrEmpty,
    civilDateValue,
    DatePicker,
  } from "../date-picker/index.ts";
  import type { GridColumn } from "./grid-columns.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";
  import { gridColumnFilterKind } from "./grid-filters.ts";
  import {
    areFacetsSelected,
    facetSelectionAfterToggle,
    facetSelectionAfterToggleValues,
    isFacetSelected,
    type FacetSelection,
  } from "./facet-selection.ts";

  type Props = { grid: DataTableGridState<TRow>; column: GridColumn<TRow> };
  let { grid, column }: Props = $props();

  const kind = $derived(gridColumnFilterKind(column));
  const active = $derived(grid.filterFor(column.id) !== undefined);

  let setQuery = $state("");

  // The set filter's stable universe (all rows, never the filtered view) with per-value counts.
  const setCounts = $derived(kind === "set" ? grid.setFilterCounts(column.id) : new Map());
  const setUniverse = $derived([...setCounts.keys()]);
  const setSelection = (): FacetSelection =>
    grid.filterFor(column.id)?.kind === "set"
      ? (grid.filterFor(column.id) as { values: readonly string[] }).values
      : undefined;
  const setNarrowed = $derived(setQuery.trim() !== "");
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

  // ONE control, reading the current state of the choices LISTED and naming the act it performs.
  const listedSelected = $derived(
    visibleSetValues.length > 0 && areFacetsSelected(setSelection(), visibleSetValues),
  );
  const selectAllLabel = $derived(
    listedSelected
      ? setNarrowed
        ? "Select none listed"
        : "Select none"
      : setNarrowed
        ? "Select all listed"
        : "Select all",
  );
  const selectAllTitle = $derived(
    listedSelected
      ? setNarrowed
        ? "Uncheck every listed choice; the rest keep their state"
        : "Uncheck every choice; the list empties until something is chosen"
      : setNarrowed
        ? "Check every listed choice; the rest keep their state"
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
  <ContextMenu.Sub onOpenChange={() => (setQuery = "")}>
    <ContextMenu.SubTrigger>
      <Funnel class="mc-table-grid-head-menu-icon" aria-hidden="true" />
      Filter {column.label}
    </ContextMenu.SubTrigger>
    <ContextMenu.SubContent class="mc-table-grid-filter-menu">
      {#if kind === "text"}
        <div class="mc-table-grid-filter-menu-field" role="presentation" onkeydown={keepMenuFieldKeys}>
          <Input
            type="search"
            size="sm"
            placeholder={column.label}
            aria-label="Filter {column.label}"
            value={textQuery()}
            oninput={(event) =>
              grid.setFilter(column.id, { kind: "text", query: event.currentTarget.value })}
          />
        </div>
      {:else if kind === "set"}
        <div class="mc-table-grid-filter-menu-field" role="presentation" onkeydown={keepMenuFieldKeys}>
          <Input
            type="search"
            size="sm"
            placeholder={column.label}
            aria-label="Narrow the {column.label} choices"
            bind:value={setQuery}
          />
        </div>
        <ContextMenu.Item
          closeOnSelect={false}
          disabled={visibleSetValues.length === 0}
          title={selectAllTitle}
          onSelect={() =>
            applySetSelection(
              facetSelectionAfterToggleValues(
                setUniverse,
                setSelection(),
                visibleSetValues,
                !listedSelected,
              ),
            )}
        >
          {selectAllLabel}
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <div class="mc-table-grid-filter-menu-facets mc-scrollbar">
          {#each visibleSetValues as value (value)}
            <ContextMenu.CheckboxItem
              bind:checked={
                () => isFacetSelected(setSelection(), value),
                (checked) =>
                  applySetSelection(
                    facetSelectionAfterToggle(setUniverse, setSelection(), value, checked),
                  )
              }
            >
              {value === "" ? "(empty)" : value}
              <span class="mc-table-grid-filter-menu-count">{setCounts.get(value)}</span>
            </ContextMenu.CheckboxItem>
          {/each}
        </div>
      {:else if kind === "range"}
        <div class="mc-table-grid-filter-menu-field" role="presentation" onkeydown={keepMenuFieldKeys}>
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
        </div>
      {:else if kind === "dateRange"}
        <div class="mc-table-grid-filter-menu-field" role="presentation" onkeydown={keepMenuFieldKeys}>
          <div class="mc-table-filter-range-row">
            <DatePicker
              size="sm"
              aria-label="From"
              value={civilDateValue(dateBound("from"))}
              onValueChange={(next) => setDateBound("from", civilDateTextOrEmpty(next))}
            />
            <span class="mc-table-filter-note">to</span>
            <DatePicker
              size="sm"
              aria-label="To"
              value={civilDateValue(dateBound("to"))}
              onValueChange={(next) => setDateBound("to", civilDateTextOrEmpty(next))}
            />
          </div>
          {#if column.filterNote}
            <p class="mc-table-filter-note">{column.filterNote}</p>
          {/if}
        </div>
      {/if}

      {#if active && kind !== "set"}
        <ContextMenu.Separator />
        <ContextMenu.Item
          title="Stop filtering by {column.label}"
          onSelect={() => grid.clearFilter(column.id)}
        >
          <FunnelX class="mc-table-grid-head-menu-icon" aria-hidden="true" />
          Clear This Filter
        </ContextMenu.Item>
      {/if}
    </ContextMenu.SubContent>
  </ContextMenu.Sub>
{/if}

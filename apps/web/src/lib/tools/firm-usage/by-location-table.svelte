<script lang="ts">
  /*
   * The By Location table — one row per location, client-side sortable by any column. Sorting is
   * local state on a table this size; the header buttons reuse the design system's mc-table-sort
   * recipe so the affordance reads the same as every other sortable header.
   *
   * The Custodian Items column is a reserved seam: the custody rollup is not wired to this read
   * yet, so every cell says "Not yet reported" rather than the column quietly not existing. The
   * "No Location Assigned" and totals rows sit outside the sort — one is a remainder, the other a
   * sum, and neither is a location.
   */
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import type { FirmUsageByLocation } from "./firm-usage-api.ts";
  import {
    ABSENT_MARKER,
    formatCount,
    sortedLocationRows,
    type LocationSortDirection,
    type LocationSortKey,
  } from "./firm-usage-format.ts";

  let { byLocation }: { byLocation: FirmUsageByLocation } = $props();

  interface LocationColumn {
    readonly key: LocationSortKey;
    readonly label: string;
    readonly numeric: boolean;
  }

  const COLUMNS: readonly LocationColumn[] = [
    { key: "name", label: "Location", numeric: false },
    { key: "status", label: "Status", numeric: false },
    { key: "matters", label: "Matters", numeric: true },
    { key: "members", label: "Members", numeric: true },
    { key: "custodianItems", label: "Custodian Items", numeric: true },
  ];

  let sortKey = $state<LocationSortKey | null>(null);
  let sortDirection = $state<LocationSortDirection>("ascending");

  function sortBy(key: LocationSortKey): void {
    if (sortKey === key) {
      sortDirection = sortDirection === "ascending" ? "descending" : "ascending";
      return;
    }
    sortKey = key;
    sortDirection = "ascending";
  }

  const rows = $derived(
    sortKey === null ? byLocation.rows : sortedLocationRows(byLocation.rows, sortKey, sortDirection),
  );

  const totalMatters = $derived(
    byLocation.rows.reduce((sum, row) => sum + row.matters, 0) + byLocation.mattersWithoutLocation,
  );
  const totalMembers = $derived(byLocation.rows.reduce((sum, row) => sum + row.members, 0));

  const TOTALS_CELL = "border-t border-border-strong font-semibold";
</script>

<DataTable.Root>
  <DataTable.Caption class="sr-only">Matters and members by location</DataTable.Caption>
  <DataTable.Header>
    <DataTable.Row>
      {#each COLUMNS as column (column.key)}
        <DataTable.Head
          data-align={column.numeric ? "end" : undefined}
          aria-sort={sortKey === column.key ? sortDirection : "none"}
        >
          <button type="button" class="mc-table-sort" onclick={() => sortBy(column.key)}>
            {column.label}
            {#if sortKey === column.key && sortDirection === "ascending"}
              <ArrowUp class="mc-table-sort-icon" aria-hidden="true" />
            {:else if sortKey === column.key}
              <ArrowDown class="mc-table-sort-icon" aria-hidden="true" />
            {:else}
              <ChevronsUpDown class="mc-table-sort-icon" aria-hidden="true" />
            {/if}
          </button>
        </DataTable.Head>
      {/each}
    </DataTable.Row>
  </DataTable.Header>
  <DataTable.Body>
    {#each rows as row (row.name)}
      <DataTable.Row>
        <DataTable.Cell>{row.name}</DataTable.Cell>
        <DataTable.Cell>{row.status === "active" ? "Active" : "Closed"}</DataTable.Cell>
        <DataTable.Cell data-align="end">{formatCount(row.matters)}</DataTable.Cell>
        <DataTable.Cell data-align="end">{formatCount(row.members)}</DataTable.Cell>
        <DataTable.Cell data-align="end">
          <span class="text-text-muted">Not yet reported</span>
        </DataTable.Cell>
      </DataTable.Row>
    {/each}
    {#if byLocation.mattersWithoutLocation > 0}
      <DataTable.Row>
        <DataTable.Cell><span class="text-text-muted">No Location Assigned</span></DataTable.Cell>
        <DataTable.Cell><span class="text-text-muted">{ABSENT_MARKER}</span></DataTable.Cell>
        <DataTable.Cell data-align="end">
          {formatCount(byLocation.mattersWithoutLocation)}
        </DataTable.Cell>
        <DataTable.Cell data-align="end">
          <span class="text-text-muted">{ABSENT_MARKER}</span>
        </DataTable.Cell>
        <DataTable.Cell data-align="end">
          <span class="text-text-muted">Not yet reported</span>
        </DataTable.Cell>
      </DataTable.Row>
    {/if}
    <DataTable.Row>
      <DataTable.Cell class={TOTALS_CELL}>Total</DataTable.Cell>
      <DataTable.Cell class={TOTALS_CELL}></DataTable.Cell>
      <DataTable.Cell data-align="end" class={TOTALS_CELL}>{formatCount(totalMatters)}</DataTable.Cell>
      <DataTable.Cell data-align="end" class={TOTALS_CELL}>{formatCount(totalMembers)}</DataTable.Cell>
      <DataTable.Cell data-align="end" class={TOTALS_CELL}>
        <span class="font-normal text-text-muted">{ABSENT_MARKER}</span>
      </DataTable.Cell>
    </DataTable.Row>
  </DataTable.Body>
</DataTable.Root>

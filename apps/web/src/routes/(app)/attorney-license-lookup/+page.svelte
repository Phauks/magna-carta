<script lang="ts">
  /*
   * Attorney License Lookup — the official register where a lawyer's standing is verified, per state.
   *
   * Bar admission is per state and every state publishes its own register, so the question a person
   * arrives with is not "is this lawyer in good standing" but "which of fifty-one pages answers
   * that, and where is it". This screen answers only the second, and hands over the live page.
   *
   * IT DELIBERATELY VERIFIES NOTHING ITSELF. The registers are the authority. Querying them here and
   * showing the answer would mean showing a copy, and a suspension is precisely the fact that
   * changes after you look, so a stale copy is worse than none. Nothing is fetched, nothing is
   * stored, and the reader reads the register rather than this screen's account of it.
   *
   * THE WHOLE REGISTER IS THE SCREEN. It used to be a state picker with one revealed card beneath
   * it, which hid fifty hyperlinks to save the reader from reading fifty-one rows — and hid with
   * them the two facts a list gives away for nothing: whether a state is covered at all, and which
   * registers are not encrypted. So the screen is the platform's one table, which brings sorting,
   * per-column narrowing from the headers, the register's address as a column to turn on, and a
   * count in the footer, none of which a picker could offer. There is no loading state because there
   * is no request: the registry is in the bundle and every row is in hand at first paint.
   *
   * TWO WAYS INTO A REGISTER, which is the table's own convention: the row's gesture opens it
   * (double-click, or Enter on the focused row), and the state's name is a link — the addition that
   * buys the browser's own gestures, a new tab and a copied address among them.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { openBeside, opensBeside } from "$lib/navigation/open-beside.ts";
  import {
    ADDRESS_COLUMN_ID,
    ATTORNEY_LICENSE_INITIAL_SORT,
    CONNECTION_COLUMN_ID,
    STATE_COLUMN_ID,
    attorneyLicenseColumns,
    attorneyLicenseRows,
    connectionEntry,
    type AttorneyLicenseRow,
  } from "$lib/tools/attorney-license/attorney-license.ts";

  const registers = attorneyLicenseRows();

  const grid = DataTable.createDataTableGrid<AttorneyLicenseRow>({
    columns: () => attorneyLicenseColumns(),
    rows: () => registers,
    rowKey: (row) => row.stateFips,
    initialSort: ATTORNEY_LICENSE_INITIAL_SORT,
    itemNoun: { singular: "register", plural: "registers" },
    onActivate: (row) => {
      openBeside(row.searchUrl, "external");
    },
  });
</script>

<svelte:head><title>Attorney License Lookup · Magna Carta</title></svelte:head>

{#snippet registerCell({ row, column, text }: DataTable.GridCellContext<AttorneyLicenseRow>)}
  {#if column.id === STATE_COLUMN_ID}
    <a
      class="text-text-link underline underline-offset-2"
      href={row.searchUrl}
      {...opensBeside("external")}
    >
      {row.state}
    </a>
  {:else if column.id === CONNECTION_COLUMN_ID}
    <!-- Loud only where it is unusual: forty-nine registers on TLS are the ordinary case and read
         as quiet text, and the two that are not carry the warning chip with what it means. -->
    {@const connection = connectionEntry(row)}
    {#if row.secure}
      <span class="text-text-muted">{connection.label}</span>
    {:else}
      <Badge variant="warning" title={connection.meaning}>{connection.label}</Badge>
    {/if}
  {:else if column.id === ADDRESS_COLUMN_ID}
    <span class="text-text-muted">{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Attorney License Lookup" />

  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-16">
    <DataTable.Grid
      {grid}
      class="min-h-0 flex-1"
      caption="Every state's official lawyer register"
      cell={registerCell}
    />

    <DataTable.GridFooter {grid} />
  </div>
</div>

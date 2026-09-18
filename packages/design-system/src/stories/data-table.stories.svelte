<script module lang="ts">
  /*
   * DataTable — Tier 4, a THIN adapter over @tanstack/table-core (not a Bits component). The styled
   * <table> primitives are presentation; sorting, row selection (incl. shift-click range select),
   * column visibility, and global-filter search are wired through `createSvelteTable` in the consumer.
   * Columns declare a value `type` in their meta so the table FORMATS them (Fees as money, Opened as a
   * date) and right-aligns numerics. A composable toolbar (Search + ColumnMenu) drives the same table
   * instance. The composition lives in `support/matters-table.svelte` (one place, reused by all three
   * states). The three states ARE the variant axis: the populated showcase (the load-profile look at
   * 100 rows), the empty state, and the deferred-load skeleton state. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ColumnDef } from "@tanstack/table-core";
  import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
  import {
    dateRangeFilterFn,
    facetFilterFn,
    renderComponent,
  } from "../lib/components/data-table/index.ts";
  import DataTableRoot from "../lib/components/data-table/table.svelte";
  import MattersTable from "./support/matters-table.svelte";
  import MatterStatusCell from "./support/matter-status-cell.svelte";

  const { Story } = defineMeta({
    title: "Data Display/DataTable",
    component: DataTableRoot,
    parameters: {
      controls: { include: [] },
    },
  });

  type Matter = { reference: string; client: string; status: string; opened: Date; fees: number };

  // CLIENTS[0] is deliberately NOT the alphabetical first, so an ascending sort visibly reorders.
  const CLIENTS = ["Zenith Holdings", "Acme Corp", "Briar LLP", "Crestwood Trust", "Dunmore Group"];
  const STATUSES = ["Open", "Pending", "Closed"];

  // 100 deterministic rows — no clock, no randomness (the visual-regression baseline must be stable).
  const MATTERS: Matter[] = Array.from({ length: 100 }, (_, index) => ({
    reference: `MAT-${1000 + index}`,
    client: CLIENTS[index % CLIENTS.length]!,
    status: STATUSES[index % STATUSES.length]!,
    opened: new Date(Date.UTC(2025, (index * 7) % 12, ((index * 13) % 27) + 1)),
    fees: ((index * 37) % 100) * 25,
  }));

  // The `type` in each column's meta is what the table formats + aligns by (Opened = date, Fees =
  // right-aligned money); text columns need no type.
  // `filter` (in meta) picks the per-column control; `filterFn` is the matching table-core matcher.
  const columns: ColumnDef<Matter>[] = [
    { accessorKey: "reference", header: "Reference", filterFn: "includesString", meta: { filter: "text" } },
    // Client uses a faceted filter — pick from all distinct values (select some, exclude others).
    { accessorKey: "client", header: "Client", filterFn: facetFilterFn, meta: { filter: "facet" } },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: facetFilterFn,
      meta: { filter: "facet" },
      cell: (context) => renderComponent(MatterStatusCell, { value: String(context.getValue()) }),
    },
    { accessorKey: "opened", header: "Opened", filterFn: dateRangeFilterFn, meta: { type: "date" } },
    {
      accessorKey: "fees",
      header: "Fees",
      filterFn: "inNumberRange",
      meta: { type: "money", currency: "USD" },
    },
  ];
</script>

<!--
  The showcase: a compact, 100-row table with sortable headers, shift-selectable rows, typed columns
  (money/date), a search box, and a column-visibility menu — the look a matter list takes at volume.
-->
<Story
  name="Data table"
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");
    const rows = () => within(table).getAllByRole("row"); // [0] is the header row

    await step("Ascending sort reorders the rows; the header announces the direction", async () => {
      const clientHeader = canvas.getByRole("button", { name: "Client" });
      await expect(rows()[1]).toHaveTextContent("Zenith Holdings"); // unsorted = data order
      await userEvent.click(clientHeader);
      await expect(clientHeader.closest("th")).toHaveAttribute("aria-sort", "ascending");
      await expect(rows()[1]).toHaveTextContent("Acme Corp");
    });

    await step("A second click flips to descending", async () => {
      const clientHeader = canvas.getByRole("button", { name: "Client" });
      await userEvent.click(clientHeader);
      await expect(clientHeader.closest("th")).toHaveAttribute("aria-sort", "descending");
      await expect(rows()[1]).toHaveTextContent("Zenith Holdings");
    });

    await step("The money column formats as currency", async () => {
      await expect(within(table).getAllByText(/^\$[\d,]+\.\d{2}$/).length).toBeGreaterThan(0);
    });

    // Shift is held via fireEvent (the window key handlers track it) — userEvent's "{/Shift}" does
    // not reliably fire a keyup in this browser-mode runner.
    const holdShift = () => fireEvent.keyDown(window, { key: "Shift" });
    const releaseShift = () => fireEvent.keyUp(window, { key: "Shift" });

    await step("Shift-click selects the whole range between two rows", async () => {
      await userEvent.click(within(rows()[1]!).getByRole("checkbox", { name: "Select row" }));
      await holdShift();
      await userEvent.click(within(rows()[4]!).getByRole("checkbox", { name: "Select row" }));
      await releaseShift();
      for (let index = 1; index <= 4; index += 1) {
        await expect(rows()[index]).toHaveAttribute("data-state", "selected");
      }
    });

    await step("Toggling a box off then shift-clicking deselects the range", async () => {
      await userEvent.click(within(rows()[1]!).getByRole("checkbox", { name: "Select row" })); // off
      await holdShift();
      await userEvent.click(within(rows()[3]!).getByRole("checkbox", { name: "Select row" }));
      await releaseShift();
      for (let index = 1; index <= 3; index += 1) {
        await expect(rows()[index]).not.toHaveAttribute("data-state", "selected");
      }
    });

    await step("The search rests as an icon and expands when it is wanted", async () => {
      await expect(canvas.queryByRole("searchbox", { name: "Search table" })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Search table" }));
      await expect(canvas.getByRole("searchbox", { name: "Search table" })).toHaveFocus();
    });

    await step("Search matches the displayed value, including dates", async () => {
      const search = canvas.getByRole("searchbox", { name: "Search table" });
      await userEvent.type(search, "Acme Corp");
      await waitFor(() => expect(within(table).queryByText("Zenith Holdings")).toBeNull());
      await userEvent.clear(search);
      // "Mar" matches the formatted date ("Mar 1, 2025") — table-core would have skipped the Date column.
      await userEvent.type(search, "Mar");
      await waitFor(() => expect(within(table).getAllByText(/Mar \d+, 2025/).length).toBeGreaterThan(0));
      await expect(within(table).getAllByRole("row").length).toBeLessThan(101);
      await userEvent.clear(search);
      // Money matches the bare number too ("2125"), not only the formatted "$2,125.00".
      await userEvent.type(search, "2125");
      await waitFor(() => expect(within(table).getByText("$2,125.00")).toBeVisible());
      await expect(within(table).getAllByRole("row").length).toBe(2); // header + the one match
      await userEvent.clear(search);
    });

    await step("The View menu hides a column and toggles appearance", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "View" }));
      const body = within(document.body);
      await userEvent.click(await body.findByRole("menuitemcheckbox", { name: "Fees" }));
      await userEvent.click(body.getByRole("menuitemcheckbox", { name: "Zebra stripes" }));
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(canvas.queryByRole("button", { name: "Fees" })).toBeNull());
      await expect(table).toHaveAttribute("data-zebra", "on");
      // Wait for the menu to fully unmount AND release the body scroll-lock (it sets the body's
      // pointer-events to none while open; the release lags the unmount by a tick).
      await waitFor(() => expect(within(document.body).queryByRole("menuitemcheckbox")).toBeNull());
      await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
    });

    await step("A faceted column filter keeps only the checked values", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Filter Status" }));
      const body = within(document.body);
      // Sheets model: every value starts checked; uncheck the others to keep only Open.
      await userEvent.click(await body.findByRole("checkbox", { name: "Closed" }));
      await userEvent.click(body.getByRole("checkbox", { name: "Pending" }));
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(within(table).queryByText("Closed")).toBeNull());
      await expect(within(table).queryByText("Pending")).toBeNull();
      await expect(within(table).getAllByText("Open").length).toBeGreaterThan(0);
    });
  }}
>
  {#snippet template()}
    <MattersTable data={MATTERS} {columns} caption="Open matters" />
  {/snippet}
</Story>

<!--
  Empty state: the toolbar and the header row stay, and the body carries DataTable.EmptyRow — one
  row, one cell across every column, one line. A reader meets the shape the rows will take before
  there are any, which is the whole point of the part; the row itself takes none of a row's
  treatment, so nothing here lights up under the pointer.
-->
<Story
  name="Empty"
  play={async ({ canvas, canvasElement, step }) => {
    await step("Shows the empty message with the header intact", async () => {
      await expect(canvas.getByText("No matters found.")).toBeVisible();
      await expect(canvas.getByRole("button", { name: "Reference" })).toBeVisible();
    });

    await step("The empty row is a placeholder, not a row", async () => {
      const placeholders = canvasElement.querySelectorAll('tr[data-placeholder="true"]');
      await expect(placeholders.length).toBe(1);
    });
  }}
>
  {#snippet template()}
    <MattersTable data={[] as Matter[]} {columns} caption="Open matters" />
  {/snippet}
</Story>

<!-- Loading state: skeleton rows stand in for data until it arrives. -->
<Story
  name="Loading"
  play={async ({ canvas, canvasElement, step }) => {
    await step("Renders skeleton placeholders, not data or the empty message", async () => {
      await expect(canvasElement.querySelectorAll(".mc-skeleton").length).toBeGreaterThan(0);
      await expect(canvas.queryByText("No matters found.")).toBeNull();
    });
  }}
>
  {#snippet template()}
    <MattersTable data={MATTERS} {columns} loading caption="Open matters" />
  {/snippet}
</Story>

<!--
  Column filters — the per-column funnels. Pins the regressions that used to bite: a faceted filter
  whose "Select all" toggle inverted to "all" when you deselected everything, options that vanished
  as the selection narrowed, and a date filter that crashed trying to open a nested calendar.
-->
<Story
  name="Column filters"
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");
    const body = within(document.body);
    // Each column filter is its own popover portalled to <body>; scope queries to the right one by its
    // heading, so a second still-open popover never makes a name (e.g. "Clear") match twice.
    const filterPopover = async (heading: string) =>
      within(
        (await body.findByText(heading, { selector: ".mc-table-filter-heading" })).closest(
          ".mc-table-filter-content",
        ) as HTMLElement,
      );

    await step("Faceted: deselecting Select all selects NONE — it never reverts to all", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Filter Client" }));
      const client = await filterPopover("Client");
      const selectAll = client.getByRole("checkbox", { name: "Select all" });
      await expect(selectAll).toBeChecked();
      await userEvent.click(selectAll);
      // None selected: the box stays unchecked, every value is unchecked, and no rows match.
      await expect(selectAll).not.toBeChecked();
      await expect(client.getByRole("checkbox", { name: "Acme Corp" })).not.toBeChecked();
      await waitFor(() => expect(within(table).getByText("No matters found.")).toBeVisible());
    });

    await step("Faceted: the value list stays complete (stable universe) and one value re-filters", async () => {
      const client = await filterPopover("Client");
      // Options never vanish when the selection empties — the universe is the unfiltered distinct set.
      await expect(client.getByRole("checkbox", { name: "Zenith Holdings" })).toBeInTheDocument();
      await userEvent.click(client.getByRole("checkbox", { name: "Acme Corp" }));
      await waitFor(() => expect(within(table).getAllByText("Acme Corp").length).toBeGreaterThan(0));
      await expect(within(table).queryByText("Zenith Holdings")).toBeNull();
      await userEvent.keyboard("{Escape}");
    });

    await step("Date: a quick preset filters the column (no nested-calendar crash) and Clear resets it", async () => {
      const opened = canvas.getByRole("button", { name: "Filter Opened" });
      await userEvent.click(opened);
      const date = await filterPopover("Opened");
      await userEvent.click(date.getByRole("button", { name: "Last 12 months" }));
      await waitFor(() => expect(opened).toHaveAttribute("data-active", "true"));
      await userEvent.click(date.getByRole("button", { name: "Clear" }));
      await waitFor(() => expect(opened).not.toHaveAttribute("data-active"));
    });
  }}
>
  {#snippet template()}
    <MattersTable data={MATTERS} {columns} caption="Open matters" />
  {/snippet}
</Story>

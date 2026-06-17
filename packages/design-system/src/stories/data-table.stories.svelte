<script module lang="ts">
  /*
   * DataTable — Tier 4, a THIN adapter over @tanstack/table-core (not a Bits component). The styled
   * <table> primitives (Table/Header/Body/Row/Head/Cell) are presentation; sorting, row selection,
   * and column visibility are wired through `createSvelteTable` in the consumer. The composition lives
   * in the `support/matters-table.svelte` worked example (one place, reused by all three states), so
   * these stories pass it data and a state flag. The three states ARE the variant axis (like Alert):
   * the populated showcase (the compact, load-profile look at 100 rows), the empty state, and the
   * deferred-load skeleton state. svelte-csf v5; FlexRender renders the plain-string headers and the
   * default-stringified accessor cells.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ColumnDef } from "@tanstack/table-core";
  import { expect, userEvent, within } from "storybook/test";
  import DataTableRoot from "../lib/components/data-table/table.svelte";
  import MattersTable from "./support/matters-table.svelte";

  const { Story } = defineMeta({
    title: "Data Display/DataTable",
    component: DataTableRoot,
    parameters: {
      controls: { include: [] },
    },
  });

  type Matter = { reference: string; client: string; status: string; fees: number };

  // CLIENTS[0] is deliberately NOT the alphabetical first, so an ascending sort visibly reorders.
  const CLIENTS = ["Zenith Holdings", "Acme Corp", "Briar LLP", "Crestwood Trust", "Dunmore Group"];
  const STATUSES = ["Open", "Pending", "Closed"];

  // 100 deterministic rows — no clock, no randomness (the visual-regression baseline must be stable).
  const MATTERS: Matter[] = Array.from({ length: 100 }, (_, index) => ({
    reference: `MAT-${1000 + index}`,
    client: CLIENTS[index % CLIENTS.length]!,
    status: STATUSES[index % STATUSES.length]!,
    fees: ((index * 37) % 100) * 25,
  }));

  const columns: ColumnDef<Matter>[] = [
    { accessorKey: "reference", header: "Reference" },
    { accessorKey: "client", header: "Client" },
    { accessorKey: "status", header: "Status" },
    { accessorKey: "fees", header: "Fees" },
  ];
</script>

<!--
  The showcase: a compact, 100-row table with sortable headers, row selection, and column-visibility
  toggles — the look a matter list takes at volume.
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

    await step("Select-all checks every row", async () => {
      await userEvent.click(canvas.getByRole("checkbox", { name: "Select all rows" }));
      await expect(rows()[1]).toHaveAttribute("data-state", "selected");
      const rowBoxes = canvas.getAllByRole("checkbox", { name: "Select row" });
      await expect(rowBoxes.every((box) => box.getAttribute("aria-checked") === "true")).toBe(true);
    });

    await step("Hiding a column removes its header", async () => {
      await userEvent.click(canvas.getByRole("checkbox", { name: "Toggle fees column" }));
      await expect(canvas.queryByRole("button", { name: "Fees" })).toBeNull();
    });
  }}
>
  {#snippet template()}
    <MattersTable data={MATTERS} {columns} caption="Open matters" />
  {/snippet}
</Story>

<!-- Empty state: the header stays, the body shows a single spanning "no results" message. -->
<Story
  name="Empty"
  play={async ({ canvas, step }) => {
    await step("Shows the empty message with the header intact", async () => {
      await expect(canvas.getByText("No matters found.")).toBeVisible();
      await expect(canvas.getByRole("button", { name: "Reference" })).toBeVisible();
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

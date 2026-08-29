<script module lang="ts">
  /*
   * DataTable.Grid — the platform's ONE table (the cross-surface one-table ruling): the
   * declarative column model driving type-aware stable sorting, in-header per-column filters,
   * column show/hide + pinning + reorder + resize, the Docket's selection model, activation as
   * its own event, the scope-honest totals row, and the footer counts. The stories compose the
   * litigation timesheet fixture through `support/litigation-grid.svelte` (one place, reused by
   * every state); the play functions ARE the behaviour tests.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";
  import Grid from "../lib/components/data-table/data-table-grid.svelte";
  import LitigationGrid from "./support/litigation-grid.svelte";

  const { Story } = defineMeta({
    title: "Data Display/DataTableGrid",
    component: Grid,
    parameters: {
      controls: { include: [] },
    },
  });

  // The activation spy lives at module scope (svelte-csf args do not round-trip through the
  // template); each play run clears it before asserting.
  const activateSpy = fn();

  /** The rendered body rows (the totals row lives in tfoot and is not among these). */
  const bodyRows = (table: HTMLElement): HTMLElement[] =>
    Array.from(table.querySelectorAll("tbody tr"));
</script>

<!--
  The showcase: the litigation timesheet at rest — anchored Date column sorted newest-first,
  typed columns (money/date/number), the status chips supplied by the consumer's cell snippet,
  the totals row, and the footer tally.
-->
<Story
  name="Data table grid"
  args={{}}
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");

    await step("Opens sorted by the anchor column, newest first", async () => {
      await expect(bodyRows(table)[0]).toHaveTextContent("Aug 14, 2026");
      const dateHeader = canvas.getByRole("button", { name: "Date" });
      await expect(dateHeader.closest("th")).toHaveAttribute("aria-sort", "descending");
    });

    await step("A numeric column sorts numerically, ascending first", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Hours" }));
      const hoursHeader = canvas.getByRole("button", { name: "Hours" });
      await expect(hoursHeader.closest("th")).toHaveAttribute("aria-sort", "ascending");
      await expect(bodyRows(table)[0]).toHaveTextContent("0.5");
      await expect(bodyRows(table)[0]).toHaveTextContent("Client call: deposition preparation");
    });

    await step("A second click flips the direction", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Hours" }));
      await expect(bodyRows(table)[0]).toHaveTextContent("3.4");
    });

    await step("Money renders as currency with the total scope-honest", async () => {
      await expect(within(table).getAllByText("$1,125.00").length).toBeGreaterThan(0);
      // Voids never count: the fixture's void entry is excluded from both sums.
      await expect(within(table).getByText("21.9 h")).toBeVisible();
      await expect(within(table).getByText("$7,072.50")).toBeVisible();
      await expect(within(table).getByText("Total")).toBeVisible();
    });

    await step("The footer tallies every entry while unfiltered", async () => {
      await expect(
        canvas.getByText(
          (_, element) =>
            element?.classList.contains("mc-table-grid-footer-tally") === true &&
            element.textContent?.replaceAll(/\s+/g, " ").trim() === "12 entries",
        ),
      ).toBeVisible();
    });
  }}
>
  {#snippet template()}
    <LitigationGrid />
  {/snippet}
</Story>

<!--
  Selection is the Docket's model and it is STATE, not presentation: the grid emits selection and
  activation and opens nothing. Double-click activates without select/deselect churn — the settled
  defect fix.
-->
<Story
  name="Selection"
  args={{}}
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");
    const activated = activateSpy;
    activated.mockClear();
    const row = (index: number): HTMLElement => bodyRows(table)[index]!;

    await step("A click selects the row solely and the footer counts it", async () => {
      await userEvent.click(row(1));
      await expect(row(1)).toHaveAttribute("data-state", "selected");
      await expect(canvas.getByTitle("Let go of the selected entry")).toBeVisible();
    });

    await step("Ctrl+click toggles a second row in", async () => {
      await fireEvent.click(row(3), { ctrlKey: true });
      await expect(row(1)).toHaveAttribute("data-state", "selected");
      await expect(row(3)).toHaveAttribute("data-state", "selected");
      await expect(canvas.getByTitle("Let go of all 2 selected entries")).toBeVisible();
    });

    await step("Shift+click extends a range from the anchor", async () => {
      await fireEvent.click(row(6), { shiftKey: true });
      for (let index = 3; index <= 6; index += 1) {
        await expect(row(index)).toHaveAttribute("data-state", "selected");
      }
      await expect(canvas.getByTitle("Let go of all 4 selected entries")).toBeVisible();
    });

    await step("Ctrl+A scoped to the grid selects everything in view", async () => {
      const region = canvas.getByRole("group", { name: "Time entries" });
      await fireEvent.keyDown(region, { key: "a", ctrlKey: true });
      await expect(canvas.getByTitle("Let go of all 12 selected entries")).toBeVisible();
      for (const bodyRow of bodyRows(table)) {
        await expect(bodyRow).toHaveAttribute("data-state", "selected");
      }
    });

    await step("Select none lets the whole selection go", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Select none" }));
      await expect(canvas.queryByRole("button", { name: "Select none" })).toBeNull();
      await expect(row(0)).not.toHaveAttribute("data-state", "selected");
    });

    await step("Arrows move the selection; Shift+arrow extends it", async () => {
      const region = canvas.getByRole("group", { name: "Time entries" });
      await userEvent.click(row(2));
      await fireEvent.keyDown(region, { key: "ArrowDown" });
      await expect(row(3)).toHaveAttribute("data-state", "selected");
      await expect(row(2)).not.toHaveAttribute("data-state", "selected");
      await fireEvent.keyDown(region, { key: "ArrowDown", shiftKey: true });
      await expect(row(3)).toHaveAttribute("data-state", "selected");
      await expect(row(4)).toHaveAttribute("data-state", "selected");
      // Left/Right also move in a list — never dead keys.
      await fireEvent.keyDown(region, { key: "ArrowLeft" });
      await expect(row(3)).toHaveAttribute("data-state", "selected");
      await expect(row(4)).not.toHaveAttribute("data-state", "selected");
      await fireEvent.keyDown(region, { key: "Escape" });
      await expect(row(3)).not.toHaveAttribute("data-state", "selected");
    });

    await step("Double-click activates as its own event, with no selection churn", async () => {
      await expect(activated).not.toHaveBeenCalled();
      await userEvent.dblClick(row(2));
      await expect(activated).toHaveBeenCalledOnce();
      // The row stays selected after the double-click — never select → deselect → select.
      await expect(row(2)).toHaveAttribute("data-state", "selected");
      await expect(activated.mock.calls[0]?.[0]).toHaveProperty("title");
    });

    await step("Clicking again on the sole selection lets it go", async () => {
      await userEvent.click(row(2));
      await expect(row(2)).not.toHaveAttribute("data-state", "selected");
    });
  }}
>
  {#snippet template()}
    <LitigationGrid onActivate={activateSpy} />
  {/snippet}
</Story>

<!--
  The one filter mechanism, parameterized by column type, living INSIDE the header cell. Active
  is unmistakable, the clear affordance exists only while a filter is in play, the footer counts
  "n of m", and the filtered-empty state says why.
-->
<Story
  name="Column filters"
  args={{}}
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");
    const body = within(document.body);
    // The funnel's space is reserved but it is REVEALED by the header cell's hover or focus (one
    // hover unit). The runner's synthetic hover cannot engage CSS :hover, so the keyboard path —
    // focus lands in the cell, :focus-within reveals the funnel — stands in for it here.
    const openFunnel = async (column: string): Promise<void> => {
      canvas.getByRole("button", { name: column }).focus();
      await userEvent.click(await canvas.findByRole("button", { name: `Filter ${column}` }));
    };

    await step("The set filter lists every value with its count", async () => {
      await openFunnel("Status");
      await waitFor(() => expect(body.getByText("Filter Status", { selector: "p" })).toBeVisible());
      const draftRow = (await body.findByRole("checkbox", { name: "Draft" })).closest("label")!;
      await expect(within(draftRow as HTMLElement).getByText("3")).toBeVisible();
      // No filter engaged yet, so no clear affordance exists — absence is the signal.
      await expect(body.queryByRole("button", { name: /Clear This Filter/ })).toBeNull();
    });

    await step("Deselecting Select all selects NONE, and the table says why it is empty", async () => {
      const selectAll = body.getByRole("checkbox", { name: "Select all" });
      await userEvent.click(selectAll);
      await expect(selectAll).not.toBeChecked();
      await waitFor(() =>
        expect(within(table).getByText(/No entries match the filter on Status/)).toBeVisible(),
      );
      await expect(within(table).getByText(/All 12 entries are hidden/)).toBeVisible();
      await expect(canvas.getByRole("button", { name: /Filtered:/ })).toHaveAttribute("data-active", "true");
    });

    await step("Checking one value keeps its rows and the footer counts n of m", async () => {
      await userEvent.click(body.getByRole("checkbox", { name: "Draft" }));
      await waitFor(() => expect(bodyRows(table)).toHaveLength(3));
      await expect(canvas.getAllByText(/Showing 3 of 12 entries · filtered/).length).toBeGreaterThan(0);
      await expect(canvas.getAllByText(/on Status/).length).toBeGreaterThan(0);
      // The totals row is scope-honest: sums speak for the rows in view.
      await expect(within(table).getByText("In view")).toBeVisible();
      await expect(within(table).getByText("7.0 h")).toBeVisible();
    });

    await step("Clear This Filter exists only while the filter is in play, and clears it", async () => {
      const clear = body.getByRole("button", { name: /Clear This Filter/ });
      await userEvent.click(clear);
      await waitFor(() => expect(bodyRows(table)).toHaveLength(12));
      await expect(body.queryByRole("button", { name: /Clear This Filter/ })).toBeNull();
      await expect(within(table).getByText("Total")).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
    });

    await step("The numeric range filter keeps rows inside its bounds", async () => {
      await openFunnel("Hours");
      const from = await body.findByRole("spinbutton", { name: "From" });
      await userEvent.type(from, "2");
      await waitFor(() => expect(bodyRows(table)).toHaveLength(6));
      await waitFor(() => expect(body.getByText("In hours, as billed.")).toBeVisible());
      await userEvent.click(body.getByRole("button", { name: /Clear This Filter/ }));
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
    });

    await step("The date range filter narrows by the work date", async () => {
      await openFunnel("Date");
      const from = await body.findByLabelText("From");
      await fireEvent.input(from, { target: { value: "2026-08-10" } });
      await waitFor(() => expect(bodyRows(table)).toHaveLength(6));
      await userEvent.click(body.getByRole("button", { name: /Clear This Filter/ }));
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
    });

    await step("The text filter matches on containment", async () => {
      await openFunnel("Title");
      const contains = await body.findByRole("searchbox", { name: "Filter Title" });
      await userEvent.type(contains, "motion");
      await waitFor(() => expect(bodyRows(table)).toHaveLength(3));
      // Clear All Filters from the footer clears every filter at once.
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
      await userEvent.click(canvas.getByRole("button", { name: "Show all" }));
      await waitFor(() => expect(bodyRows(table)).toHaveLength(12));
    });
  }}
>
  {#snippet template()}
    <LitigationGrid />
  {/snippet}
</Story>

<!--
  The columns menu: show/hide with the anchored column immovable, the pin control per row (the
  anchored block joins the sticky set so pinned columns are contiguous from the leading edge),
  and the zebra display setting.
-->
<Story
  name="Columns and pinning"
  args={{}}
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");
    const body = within(document.body);

    await step("The columns menu shows a hidden column on demand", async () => {
      await expect(canvas.queryByRole("button", { name: "Entry Number" })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Columns" }));
      await userEvent.click(await body.findByRole("checkbox", { name: "Entry Number" }));
      await expect(canvas.getByRole("button", { name: "Entry Number" })).toBeVisible();
      await expect(within(table).getAllByText("2026-0147.0001").length).toBeGreaterThan(0);
    });

    await step("The anchored column cannot be hidden — it always shows", async () => {
      const dateCheckbox = body.getByRole("checkbox", { name: "Date" });
      await expect(dateCheckbox).toBeDisabled();
      await expect(dateCheckbox).toBeChecked();
    });

    await step("Pinning a column makes the anchored block + it sticky, contiguously", async () => {
      await userEvent.click(
        body.getByRole("button", {
          name: "Pin Timekeeper so it keeps its place when the list scrolls sideways",
        }),
      );
      const timekeeperHead = canvas
        .getByRole("button", { name: "Timekeeper" })
        .closest("th")!;
      const dateHead = canvas.getByRole("button", { name: "Date" }).closest("th")!;
      await waitFor(() => expect(timekeeperHead).toHaveAttribute("data-pinned", "true"));
      await expect(dateHead).toHaveAttribute("data-pinned", "true");
      // The pinned block is contiguous: Timekeeper renders directly after the anchor.
      const headers = Array.from(table.querySelectorAll("thead th")).map(
        (headCell) => headCell.getAttribute("data-grid-column"),
      );
      await expect(headers[0]).toBe("workDate");
      await expect(headers[1]).toBe("timekeeper");
      // The last sticky column carries the edge hairline.
      await expect(timekeeperHead).toHaveAttribute("data-pinned-edge", "true");
      // Offsets are measured: the anchor sits at the leading edge, the next after its width.
      await expect(dateHead.style.insetInlineStart).toBe("0px");
      await expect(timekeeperHead.style.insetInlineStart).not.toBe("");
    });

    await step("Zebra striping is the columns menu's display setting", async () => {
      await userEvent.click(body.getByRole("checkbox", { name: "Shade alternate rows" }));
      await expect(table).toHaveAttribute("data-zebra", "on");
    });
  }}
>
  {#snippet template()}
    <LitigationGrid />
  {/snippet}
</Story>

<!-- Loading: skeleton rows stand in for data until it arrives. -->
<Story
  name="Loading"
  args={{}}
  play={async ({ canvas, canvasElement, step }) => {
    await step("Renders skeleton placeholders, not data or an empty message", async () => {
      await expect(canvasElement.querySelectorAll(".mc-skeleton").length).toBeGreaterThan(0);
      await expect(canvas.queryByText(/No entries/)).toBeNull();
    });
  }}
>
  {#snippet template()}
    <LitigationGrid loading />
  {/snippet}
</Story>

<!-- Empty (unfiltered): distinct from filtered-empty — nothing exists yet, nothing is hidden. -->
<Story
  name="Empty"
  args={{}}
  play={async ({ canvas, step }) => {
    await step("Says there is nothing yet, with the header intact", async () => {
      await expect(canvas.getByText("No entries yet.")).toBeVisible();
      await expect(canvas.getByRole("button", { name: "Date" })).toBeVisible();
    });
  }}
>
  {#snippet template()}
    <LitigationGrid rows={[]} />
  {/snippet}
</Story>

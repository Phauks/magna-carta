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
  import LitigationGrid, { TIME_COLUMNS } from "./support/litigation-grid.svelte";

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

  // The row-groups fixture: two entries pinned in a deliberate arrangement (the OLDER one first,
  // so the block cannot be mistaken for the sort), and two rows waiting on the clipboard.
  const PINNED_ROW_KEYS = ["t12", "t05"];
  const CLIPBOARD_MARKS: Record<string, "cut" | "copy" | undefined> = { t04: "cut", t07: "copy" };

  // The Time Sheet's shape: the Status column stuck to the trailing edge while the rest scrolls.
  const TRAILING_PINNED_COLUMNS = TIME_COLUMNS.map((column) =>
    column.id === "status" ? Object.assign({}, column, { pinnedEnd: true }) : column,
  );
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
  The one filter mechanism, parameterized by column type, living in the header's OWN menu — the
  cell itself carries no control, only the mark that says a filter is in play. Active is
  unmistakable, the clear affordance exists only while a filter is in play, the footer counts
  "n of m", and the filtered-empty state says why.
-->
<Story
  name="Column filters"
  args={{}}
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");
    const body = within(document.body);
    const headOf = (label: string): HTMLElement =>
      canvas.getByRole("button", { name: label }).closest("th")!;
    // Right-click the heading, then step into the column's Filter submenu — the one way in.
    const openFilter = async (label: string): Promise<void> => {
      await fireEvent.contextMenu(headOf(label));
      await body.findByRole("menu");
      await userEvent.click(body.getByRole("menuitem", { name: `Filter ${label}` }));
      await waitFor(() => expect(body.getAllByRole("menu").length).toBeGreaterThan(1));
    };
    const closeMenu = async (): Promise<void> => {
      await userEvent.keyboard("{Escape}{Escape}");
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
    };

    await step("The header cell carries no filter control at all", async () => {
      await expect(canvas.queryByRole("button", { name: /^Filter / })).toBeNull();
    });

    await step("The set filter lists every value with its count", async () => {
      await openFilter("Status");
      // Bits settles the submenu after positioning, so re-query rather than holding a node.
      await waitFor(() =>
        expect(
          within(body.getByRole("menuitemcheckbox", { name: /^Draft/ })).getByText("3"),
        ).toBeVisible(),
      );
    });

    await step("Every ghost text is the FIELD'S NAME, never an instruction", async () => {
      // The narrow field above the choices carries the column's own name — no "Type to…" hint.
      const narrow = body.getByRole("searchbox", { name: "Narrow the Status choices" });
      await expect(narrow).toHaveAttribute("placeholder", "Status");
    });

    await step("A set filter carries NO clear control — everything selected IS no filter", async () => {
      await expect(body.queryByRole("menuitem", { name: /Clear This Filter/ })).toBeNull();
    });

    await step("The select control is ONE control that says what pressing it will do", async () => {
      // Everything is on, so the one control offers the act that is available: select none.
      await expect(body.queryByRole("menuitem", { name: "Select all" })).toBeNull();
      await userEvent.click(body.getByRole("menuitem", { name: "Select none" }));
      // Nothing is on now, so the SAME control reads the other way.
      await waitFor(() => expect(body.getByRole("menuitem", { name: "Select all" })).toBeVisible());
      await expect(body.queryByRole("menuitem", { name: "Select none" })).toBeNull();
    });

    await step("Selecting none empties the list, and the table says why", async () => {
      await waitFor(() =>
        expect(within(table).getByText(/No entries match the filter on Status/)).toBeVisible(),
      );
      await expect(within(table).getByText(/All 12 entries are hidden/)).toBeVisible();
      // Even with a filter in play, a SET filter still carries no clear control of its own.
      await expect(body.queryByRole("menuitem", { name: /Clear This Filter/ })).toBeNull();
    });

    await step("The header cell MARKS the filtered column, without offering a control", async () => {
      const mark = headOf("Status").querySelector(".mc-table-grid-filter-mark")!;
      await expect(mark).toHaveAttribute("data-active", "true");
      await expect(mark.querySelector("svg")).not.toBeNull();
      await expect(mark.getAttribute("title")).toMatch(/^Filtered: /);
      // An unfiltered column keeps the slot and draws nothing in it.
      const quiet = headOf("Title").querySelector(".mc-table-grid-filter-mark")!;
      await expect(quiet).not.toHaveAttribute("data-active");
      await expect(quiet.querySelector("svg")).toBeNull();
    });

    await step("Checking one value keeps its rows and the footer counts n of m", async () => {
      await userEvent.click(body.getByRole("menuitemcheckbox", { name: /^Draft/ }));
      await waitFor(() => expect(bodyRows(table)).toHaveLength(3));
      await expect(canvas.getAllByText(/Showing 3 of 12 entries · filtered/).length).toBeGreaterThan(0);
      await expect(canvas.getAllByText(/on Status/).length).toBeGreaterThan(0);
      // The totals row is scope-honest: sums speak for the rows in view.
      await expect(within(table).getByText("In view")).toBeVisible();
      await expect(within(table).getByText("7.0 h")).toBeVisible();
    });

    await step("Select all returns the whole set, which is no filter at all", async () => {
      await userEvent.click(body.getByRole("menuitem", { name: "Select all" }));
      await waitFor(() => expect(bodyRows(table)).toHaveLength(12));
      await expect(within(table).getByText("Total")).toBeVisible();
      await closeMenu();
      await expect(
        headOf("Status").querySelector(".mc-table-grid-filter-mark"),
      ).not.toHaveAttribute("data-active");
    });

    await step("The numeric range filter keeps rows inside its bounds", async () => {
      await openFilter("Hours");
      const from = await body.findByRole("spinbutton", { name: "From" });
      // "From" and "To" ARE the fields' names, so they stand as ghost text.
      await expect(from).toHaveAttribute("placeholder", "From");
      await userEvent.type(from, "2");
      // A field inside a menu keeps its own keys: typing did not hand focus to a menu item.
      await expect(from).toHaveFocus();
      await waitFor(() => expect(bodyRows(table)).toHaveLength(6));
      await waitFor(() => expect(body.getByText("In hours, as billed.")).toBeVisible());
      // A range filter DOES carry a clear control, and only while the filter is in play.
      await userEvent.click(body.getByRole("menuitem", { name: /Clear This Filter/ }));
      await waitFor(() => expect(bodyRows(table)).toHaveLength(12));
      await closeMenu();
    });

    await step("The date range filter narrows by the work date", async () => {
      await openFilter("Date");
      const from = await body.findByLabelText("From");
      await fireEvent.input(from, { target: { value: "2026-08-10" } });
      await waitFor(() => expect(bodyRows(table)).toHaveLength(6));
      await userEvent.click(body.getByRole("menuitem", { name: /Clear This Filter/ }));
      await closeMenu();
    });

    await step("The text filter matches on containment", async () => {
      await openFilter("Title");
      const contains = await body.findByRole("searchbox", { name: "Filter Title" });
      // The ghost text is the field's name, not a description of the matching rule.
      await expect(contains).toHaveAttribute("placeholder", "Title");
      await userEvent.type(contains, "motion");
      await expect(contains).toHaveFocus();
      await waitFor(() => expect(bodyRows(table)).toHaveLength(3));
      // Clear All Filters from the footer clears every filter at once.
      await closeMenu();
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
  The header's own menu (right-click a column heading): hide and pin the column being pointed at,
  and one arrow to the right the full roster — show/hide with the anchored column immovable, and
  the zebra display setting. There is no columns button anywhere on the surface.
-->
<Story
  name="Columns and pinning"
  args={{}}
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");
    const body = within(document.body);
    // The sort control's accessible name is its own text — the column label — so the header cell
    // it sits in is reachable from the label alone.
    const headOf = (label: string): HTMLElement =>
      canvas.getByRole("button", { name: label }).closest("th")!;
    const openColumns = async (label: string): Promise<void> => {
      await fireEvent.contextMenu(headOf(label));
      await body.findByRole("menu");
      await userEvent.click(body.getByRole("menuitem", { name: "Columns" }));
      await waitFor(() => expect(body.getAllByRole("menu").length).toBeGreaterThan(1));
    };
    const closeMenu = async (): Promise<void> => {
      await userEvent.keyboard("{Escape}{Escape}");
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
    };

    await step("The header's Columns submenu shows a hidden column on demand", async () => {
      await expect(canvas.queryByRole("button", { name: "Entry Number" })).toBeNull();
      await openColumns("Date");
      await userEvent.click(body.getByRole("menuitemcheckbox", { name: "Entry Number" }));
      await expect(canvas.getByRole("button", { name: "Entry Number" })).toBeVisible();
      await expect(within(table).getAllByText("2026-0147.0001").length).toBeGreaterThan(0);
    });

    await step("The anchored column cannot be hidden — it always shows", async () => {
      const dateRow = body.getByRole("menuitemcheckbox", { name: "Date" });
      await expect(dateRow).toHaveAttribute("data-disabled");
      await expect(dateRow).toHaveAttribute("aria-checked", "true");
      await closeMenu();
    });

    await step("Hiding a column is on the column being pointed at", async () => {
      await fireEvent.contextMenu(headOf("Entry Number"));
      await body.findByRole("menu");
      await userEvent.click(body.getByRole("menuitem", { name: "Hide Entry Number" }));
      await waitFor(() =>
        expect(canvas.queryByRole("button", { name: "Entry Number" })).toBeNull(),
      );
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
    });

    await step("Pinning a column makes the anchored block + it sticky, contiguously", async () => {
      await fireEvent.contextMenu(headOf("Timekeeper"));
      await body.findByRole("menu");
      await userEvent.click(body.getByRole("menuitem", { name: "Pin Timekeeper" }));
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
      const timekeeperHead = headOf("Timekeeper");
      const dateHead = headOf("Date");
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

    await step("The pin is ONE glyph; fill is the only difference between pinned and not", async () => {
      await fireEvent.contextMenu(headOf("Timekeeper"));
      await body.findByRole("menu");
      const pinnedGlyph = body
        .getByRole("menuitem", { name: "Unpin Timekeeper" })
        .querySelector("svg")!;
      await expect(pinnedGlyph.classList.contains("lucide-pin")).toBe(true);
      await expect(pinnedGlyph).toHaveAttribute("fill", "currentColor");
      const pinnedPaths = pinnedGlyph.innerHTML;
      await closeMenu();

      await fireEvent.contextMenu(headOf("Title"));
      await body.findByRole("menu");
      const unpinnedGlyph = body
        .getByRole("menuitem", { name: "Pin Title" })
        .querySelector("svg")!;
      // classList matching is exact per token, so `lucide-pin-off` could never satisfy it.
      await expect(unpinnedGlyph.classList.contains("lucide-pin")).toBe(true);
      // Same geometry, so the drawn paths are identical; only the fill differs.
      await expect(unpinnedGlyph.innerHTML).toBe(pinnedPaths);
      await expect(unpinnedGlyph).toHaveAttribute("fill", "none");
      await closeMenu();
    });

    await step("Zebra striping is the Columns submenu's display setting", async () => {
      await openColumns("Date");
      await userEvent.click(body.getByRole("menuitemcheckbox", { name: "Shade alternate rows" }));
      await expect(table).toHaveAttribute("data-zebra", "on");
      await closeMenu();
    });
  }}
>
  {#snippet template()}
    <LitigationGrid />
  {/snippet}
</Story>

<!--
  Row groups and row marks: pinned items sit above EVERYTHING, separated by a rule, in the
  member's own arranged order rather than the table's sort. The marks are one vocabulary — the
  filled pin, a clipboard mark while a row waits on a cut or copy, and a quieter voice for a row
  that is present but not of the list's own kind.
-->
<Story
  name="Row groups and marks"
  args={{}}
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");
    const dataRows = (): HTMLElement[] =>
      Array.from(table.querySelectorAll("tbody tr[data-grid-row]"));

    await step("Pinned rows lead, above everything, in the arranged order", async () => {
      const keys = dataRows().map((row) => row.getAttribute("data-grid-row"));
      // t12 is the fixture's OLDEST entry and the table sorts newest-first, so its place at the
      // top can only come from the pin — and t05 follows it because that is how they were arranged.
      await expect(keys.slice(0, 2)).toEqual(["t12", "t05"]);
      await expect(dataRows()[0]).toHaveAttribute("data-row-pinned", "true");
      await expect(dataRows()[2]).not.toHaveAttribute("data-row-pinned");
    });

    await step("A rule separates the pinned block from the list beneath it", async () => {
      const bodyChildren = Array.from(table.querySelectorAll("tbody tr"));
      const ruleIndex = bodyChildren.findIndex((row) =>
        row.classList.contains("mc-table-grid-pin-rule"),
      );
      // Exactly one rule, and it sits directly after the two pinned rows.
      await expect(table.querySelectorAll(".mc-table-grid-pin-rule")).toHaveLength(1);
      await expect(ruleIndex).toBe(2);
      await expect(bodyChildren[ruleIndex]?.querySelector("td")).toHaveAttribute("colspan");
    });

    await step("A pinned row carries the filled Lucide pin in its first cell", async () => {
      const glyph = dataRows()[0]!.querySelector("td svg")!;
      await expect(glyph.classList.contains("lucide-pin")).toBe(true);
      await expect(glyph).toHaveAttribute("fill", "currentColor");
      // An unpinned row carries no pin at all.
      await expect(dataRows()[2]!.querySelector(".mc-table-grid-row-pin")).toBeNull();
    });

    await step("A row waiting on the clipboard says which act it is waiting on", async () => {
      const marked = dataRows().filter((row) => row.hasAttribute("data-clipboard"));
      await expect(marked).toHaveLength(2);
      await expect(marked.map((row) => row.getAttribute("data-clipboard")).toSorted()).toEqual([
        "copy",
        "cut",
      ]);
    });

    await step("A row that is not of the list's own kind reads quieter", async () => {
      const quiet = dataRows().filter((row) => row.getAttribute("data-quiet") === "true");
      await expect(quiet).toHaveLength(1);
      await expect(quiet[0]).toHaveTextContent("Draft meet-and-confer letter");
    });

    await step("Selection and activation still walk the grouped order", async () => {
      await userEvent.click(dataRows()[0]!);
      await expect(dataRows()[0]).toHaveAttribute("data-state", "selected");
      const region = canvas.getByRole("group", { name: "Time entries" });
      await fireEvent.keyDown(region, { key: "ArrowDown" });
      // The next row down is the second PINNED row, not the sort's second row.
      await expect(dataRows()[1]).toHaveAttribute("data-state", "selected");
      await expect(dataRows()[1]).toHaveAttribute("data-grid-row", "t05");
    });
  }}
>
  {#snippet template()}
    <LitigationGrid
      pinnedRowKeys={PINNED_ROW_KEYS}
      rowMark={(row) => ({
        pinned: PINNED_ROW_KEYS.includes(row.id),
        clipboard: CLIPBOARD_MARKS[row.id],
        // A void entry stands in here for the shape a deleted match or an inherited event takes.
        quiet: row.status === "Void",
      })}
    />
  {/snippet}
</Story>

<!--
  The Time Sheet's two grid capabilities together: a TRAILING pinned column (Status stays stuck to
  the end edge while the table scrolls sideways, a leading hairline saying "pinned, not floating")
  and the row-detail second line (each record is two <tr>s reading as ONE row of two lines — the
  hairline moves to the second line, and hover/selection cover the pair).
-->
<Story
  name="Trailing pin and row detail"
  args={{}}
  play={async ({ canvas, step }) => {
    const table = canvas.getByRole("table");
    const primaryRow = (index: number): HTMLElement =>
      Array.from(table.querySelectorAll("tbody tr[data-grid-row]"))[index] as HTMLElement;
    const detailRow = (index: number): HTMLElement =>
      Array.from(table.querySelectorAll("tbody tr[data-grid-detail-row]"))[index] as HTMLElement;

    await step("The trailing-pinned column renders last, stuck to the end edge", async () => {
      const statusHead = canvas.getByRole("button", { name: "Status" }).closest("th")!;
      // The offsets are measured from the rendered header, so the attributes land after mount.
      await waitFor(() => expect(statusHead).toHaveAttribute("data-pinned-end", "true"));
      await expect(statusHead).toHaveAttribute("data-pinned-end-edge", "true");
      await expect(statusHead.style.insetInlineEnd).toBe("0px");
      // Last in render order, whatever the member-set order says.
      const headers = Array.from(table.querySelectorAll("thead th"));
      await expect(headers.at(-1)?.getAttribute("data-grid-column")).toBe("status");
      // Both its edges are declared, so it offers no drag.
      await expect(statusHead).not.toHaveAttribute("draggable");
    });

    await step("Its body and totals cells stick with it", async () => {
      await waitFor(() =>
        expect(
          primaryRow(0).querySelector('td[data-pinned-end="true"][data-pinned-end-edge="true"]'),
        ).not.toBeNull(),
      );
      const totalsCells = Array.from(table.querySelectorAll("tfoot td"));
      await expect(
        totalsCells.filter((cellElement) => cellElement.getAttribute("data-pinned-end") === "true"),
      ).toHaveLength(1);
    });

    await step("Each record carries its second line across the scrolling columns", async () => {
      await expect(table).toHaveAttribute("data-row-detail", "on");
      await expect(table.querySelectorAll("tbody tr[data-grid-detail-row]")).toHaveLength(12);
      // Seven columns show (Entry Number starts hidden): six scrolling + the trailing pin, so
      // the second line spans the six and keeps an empty pinned cell for the hairline.
      const detailCells = detailRow(0).querySelectorAll("td");
      await expect(detailCells).toHaveLength(2);
      await expect(detailCells[0]).toHaveAttribute("colspan", "6");
      await expect(detailCells[1]).toHaveAttribute("data-pinned-end", "true");
      await expect(detailCells[1]).toHaveTextContent("");
      await expect(detailRow(0)).toHaveTextContent("Recorded by");
    });

    await step("The pair is ONE hover unit — either line hovered marks both", async () => {
      await fireEvent.pointerEnter(primaryRow(1));
      await expect(primaryRow(1)).toHaveAttribute("data-pair-hover", "true");
      await expect(detailRow(1)).toHaveAttribute("data-pair-hover", "true");
      await fireEvent.pointerLeave(primaryRow(1));
      await expect(primaryRow(1)).not.toHaveAttribute("data-pair-hover");
      await expect(detailRow(1)).not.toHaveAttribute("data-pair-hover");
    });

    await step("Selection covers the pair, from either line", async () => {
      await userEvent.click(detailRow(2));
      await expect(primaryRow(2)).toHaveAttribute("data-state", "selected");
      await expect(detailRow(2)).toHaveAttribute("data-state", "selected");
      await userEvent.click(primaryRow(2));
      await expect(primaryRow(2)).not.toHaveAttribute("data-state", "selected");
      await expect(detailRow(2)).not.toHaveAttribute("data-state", "selected");
    });

    await step("The columns menu holds the trailing pin — it is not the member's to move", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Columns" }));
      const body = within(document.body);
      const heldPin = await body.findByRole("button", {
        name: "Status always keeps its place at the trailing edge",
      });
      await expect(heldPin).toBeDisabled();
      await expect(heldPin).toHaveAttribute("aria-pressed", "true");
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
    });
  }}
>
  {#snippet template()}
    <LitigationGrid columns={TRAILING_PINNED_COLUMNS}>
      {#snippet rowDetail(row)}
        Recorded by {row.timekeeper}: {row.title}.
      {/snippet}
    </LitigationGrid>
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

<!--
  A surface's OWN empty state, which is the one that broke.

  The grid's built-in empty renders inside `.mc-table-grid-empty` and sets its own white-space, so
  it could never show this. A surface-supplied snippet renders bare in the placeholder cell and
  inherits the cell's `white-space: nowrap` — set by `.mc-table-grid .mc-table-cell`, two classes.
  A one-class override loses to it silently, which is exactly how the fix shipped once doing
  nothing at all. So the assertion is the SYMPTOM, not the rule: prose in an empty table must not
  push the table wider than the frame it scrolls in.
-->
<Story
  name="EmptyWithSurfaceProse"
  args={{}}
  play={async ({ canvas, step }) => {
    const scroll = canvas.getByRole("table").closest(".mc-table-grid-scroll");
    if (!(scroll instanceof HTMLElement)) throw new Error("the grid has no scroll frame");

    await step("The placeholder cell wraps rather than inheriting the row nowrap", async () => {
      const placeholder = scroll.querySelector(".mc-table-grid-placeholder");
      if (!(placeholder instanceof HTMLElement)) throw new Error("no placeholder cell");
      // The COMPUTED value, because the defect was a specificity loss: the rule was present in the
      // stylesheet and beaten, which any assertion about the stylesheet itself would have passed.
      await expect(getComputedStyle(placeholder).whiteSpace).not.toBe("nowrap");
    });

    await step("A wordy empty state does not widen the table past its frame", async () => {
      await expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);
    });
  }}
>
  {#snippet template()}
    <LitigationGrid rows={[]}>
      {#snippet empty()}
        A packet is the physical thing the firm holds and moves: an envelope, a deed box, a sealed
        wallet. It carries a custody number, the person or organization it is held for, and
        everything that has ever happened to it. Logging the first one draws the firm's first
        custody number.
      {/snippet}
    </LitigationGrid>
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

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
  import LitigationGrid, { TIME_COLUMNS, TIME_ENTRIES } from "./support/litigation-grid.svelte";

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

  /*
   * The rendered RECORD rows.
   *
   * `data-grid-row` is the component's own mark for "this row is a record", and filtering on it is
   * the only correct way to count them: the body deliberately holds structural rows besides the
   * records — the pin rule, a row-detail's second line, and the filler that holds the totals strip
   * down at the bottom of the frame. A bare `tbody tr` counts those too, which is a count that
   * changes when the table's chrome changes rather than when its data does.
   */
  const bodyRows = (table: HTMLElement): HTMLElement[] =>
    Array.from(table.querySelectorAll("tbody tr[data-grid-row]"));

  // The row-groups fixture: two entries pinned in a deliberate arrangement (the OLDER one first,
  // so the block cannot be mistaken for the sort), and two rows waiting on the clipboard.
  const PINNED_ROW_KEYS = ["t12", "t05"];
  const CLIPBOARD_MARKS: Record<string, "cut" | "copy" | undefined> = { t04: "cut", t07: "copy" };

  // The same columns with their sums taken off, so the table renders no totals strip — the one
  // state in which the last record is the body's last child and the card's last-row rule reaches it.
  const UNTOTALLED_COLUMNS = TIME_COLUMNS.map(({ total, totalText, ...column }) => column);

  // The Time Sheet's shape: the Status column stuck to the trailing edge while the rest scrolls.
  const TRAILING_PINNED_COLUMNS = TIME_COLUMNS.map((column) =>
    column.id === "status" ? Object.assign({}, column, { pinnedEnd: true }) : column,
  );

  // Columns summing to far more than any story frame, so the placeholder row's cell is wider than
  // what the reader can see — the state a member reaches by widening a couple of columns.
  const OVERWIDE_COLUMN_WIDTHS = Object.fromEntries(
    TIME_COLUMNS.map((column) => [column.id, 420]),
  );

  /** Where a box sits and how wide it is, in page coordinates. */
  const box = (element: Element): { start: number; end: number; centre: number } => {
    const rectangle = element.getBoundingClientRect();
    return {
      start: rectangle.left,
      end: rectangle.right,
      centre: rectangle.left + rectangle.width / 2,
    };
  };
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

    // A record offers itself to the pointer, and this is the CONTROL for the empty table's own
    // step further down, which asserts the opposite. The claim is measured through the cursor
    // rather than the hover fill: the driver's synthetic pointer events do not put the element
    // into :hover here, so an assertion about the fill would pass whatever the recipe said. The
    // cursor comes from the same `:not([data-placeholder])` scoping and needs no pointer at all,
    // so it is the part of the treatment a story can actually hold.
    await step("A record offers itself to the pointer", async () => {
      const [record] = bodyRows(table);
      await expect(record).toBeDefined();
      if (record === undefined) return;
      await expect(globalThis.getComputedStyle(record).cursor).toBe("pointer");
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
      const menu = await body.findByRole("menu");
      // Wait for focus to be INSIDE the menu, not merely for the menu to exist. The menu takes
      // focus on open (the panel, then its first item), but on the next animation frame rather
      // than synchronously with its mount. A step that opens the submenu and focuses its field
      // before that frame fires has the frame land afterwards and move focus back to the menu
      // panel, mid-word (seen 2026-09-03, under the story suite's load, in one run of six). Once
      // focus is inside the menu, its open-time work is spent.
      await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
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

    await step("Selecting none empties the list, and the way back is a control", async () => {
      // Two words, the same two an unfiltered empty table says. The sentence that used to name the
      // filters here was a second copy of what the header already shows; the control that undoes
      // them is the part a reader cannot get from looking at the header, so that is what stays.
      await waitFor(() => expect(within(table).getByText("No Results")).toBeVisible());
      await expect(within(table).getByRole("button", { name: /Clear All Filters/ })).toBeVisible();
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
    });

    await step("Narrowing the list scopes the one control to what is listed", async () => {
      // The narrow field takes the keys itself (the menu's typeahead does not), and the list
      // under it shrinks to the choices that match.
      const narrow = body.getByRole("searchbox", { name: "Narrow the Status choices" });
      // The root menu carries checkbox rows of its own (the display settings), so the choices
      // are counted inside the filter submenu alone.
      const submenu = within(narrow.closest('[role="menu"]') as HTMLElement);
      narrow.focus();
      await userEvent.keyboard("dra");
      await waitFor(() => expect(submenu.getAllByRole("menuitemcheckbox")).toHaveLength(1));
      // Everything listed is on, so the control offers to uncheck the listed choices — and says
      // "listed", because the rest of the set is not on the table.
      await expect(body.queryByRole("menuitem", { name: "Select none" })).toBeNull();
      await userEvent.click(body.getByRole("menuitem", { name: "Select none listed" }));
      // Only Draft went off: the three Draft rows leave and the other nine stay.
      await waitFor(() => expect(bodyRows(table)).toHaveLength(9));
      await waitFor(() =>
        expect(body.getByRole("menuitem", { name: "Select all listed" })).toBeVisible(),
      );
      // Clearing the narrowing shows the whole set again, with Draft still off and the control
      // back to speaking for everything.
      narrow.focus();
      await userEvent.keyboard("{Control>}a{/Control}{Backspace}");
      await waitFor(() => expect(submenu.getAllByRole("menuitemcheckbox").length).toBeGreaterThan(1));
      await userEvent.click(body.getByRole("menuitem", { name: "Select all" }));
      await waitFor(() => expect(bodyRows(table)).toHaveLength(12));
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
      // The field is focused and the keys sent to it: what this step asserts is the keyboard
      // rule, so only the keyboard is in play.
      from.focus();
      await userEvent.keyboard("2");
      // A field inside a menu keeps its own keys: typing did not hand focus to a menu item.
      await expect(from).toHaveFocus();
      await waitFor(() => expect(bodyRows(table)).toHaveLength(6));
      await waitFor(() => expect(body.getByText("In hours, as billed.")).toBeVisible());
      // A range filter DOES carry a clear control, and only while the filter is in play.
      await userEvent.click(body.getByRole("menuitem", { name: /Clear This Filter/ }));
      await waitFor(() => expect(bodyRows(table)).toHaveLength(12));
      await closeMenu();
    });

    await step("The date range filter narrows by the work date, typed into the segments", async () => {
      await openFilter("Date");
      // The date bound is the platform's DatePicker, not a native date input: a group of editable
      // segments named by aria-label, since a range's two boxes have no room for a visible one.
      const from = await body.findByLabelText("From");
      await expect(from).toHaveAttribute("role", "group");
      within(from).getAllByRole("spinbutton")[0]!.focus();
      // en-US order: month, day, year. Bits advances to the next segment as each one fills.
      await userEvent.keyboard("08102026");
      await waitFor(() => expect(bodyRows(table)).toHaveLength(6));
      // A field inside a menu keeps its own keys — the digits did not run the menu's typeahead,
      // which would have taken focus out of the field and onto an item.
      await expect(from).toContainElement(document.activeElement as HTMLElement);
    });

    await step("Its calendar opens INSIDE the menu, and neither layer dismisses the other", async () => {
      // The sibling column filter records that a calendar nested in ITS popover crashed the
      // floating layer, so this is asserted rather than assumed: the popover opens, the filter
      // submenu survives it, and picking a day reaches the filter underneath.
      const from = await body.findByLabelText("From");
      await userEvent.click(within(from).getByRole("button", { name: "Open calendar" }));
      const grid = await body.findByRole("grid");
      // Focus really moved into the calendar. In a browser a member is using, that arrival is a
      // `focusin` the submenu's layer hears and used to answer by closing — and unmounting the
      // field whose calendar had just opened. The harness cannot be trusted to fire it (its page
      // may hold no system focus), so the event the browser would have fired is fired here, and
      // the submenu has to still be OPEN after the layer has heard it — open by its own state,
      // because a closed panel stays in the DOM through its exit transition, and a story that
      // only looked for the panel passed on the build that had the defect.
      const submenu = from.closest('[role="menu"]') as HTMLElement;
      await waitFor(() => expect(grid).toContainElement(document.activeElement as HTMLElement));
      document.activeElement?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      await expect(submenu).toHaveAttribute("data-state", "open");
      await expect(body.getByLabelText("To")).toBeVisible();
      // The calendar opened on the month the field already holds, so the 12th moves the lower
      // bound forward two days and takes two more rows out.
      await userEvent.click(within(grid).getByText("12"));
      await waitFor(() => expect(bodyRows(table)).toHaveLength(4));
      await expect(body.getByLabelText("From")).toHaveTextContent("12");
      await expect(body.getByLabelText("To")).toBeVisible();
      await userEvent.click(body.getByRole("menuitem", { name: /Clear This Filter/ }));
      await waitFor(() => expect(bodyRows(table)).toHaveLength(12));
      await closeMenu();
    });

    await step("The text filter matches on containment", async () => {
      await openFilter("Title");
      const contains = await body.findByRole("searchbox", { name: "Filter Title" });
      // The ghost text is the field's name, not a description of the matching rule.
      await expect(contains).toHaveAttribute("placeholder", "Title");
      // Keyboard only, for the reason given at the numeric range step above.
      contains.focus();
      await userEvent.keyboard("motion");
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

    await step("Zebra striping is a display setting in the menu's own root", async () => {
      // Not inside Columns: Columns holds columns. A setting about how the table LOOKS is one
      // gesture away, in the menu the reader already has open.
      await fireEvent.contextMenu(headOf("Date"));
      await body.findByRole("menu");
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

    await step("The header menu holds the trailing pin — it is not the member's to move", async () => {
      // The column's controls live in its own header's right-click menu (see "Columns and pinning").
      const statusHead = canvas.getByRole("button", { name: "Status" }).closest("th")!;
      await fireEvent.contextMenu(statusHead);
      const body = within(document.body);
      await body.findByRole("menu");
      const heldPin = body.getByRole("menuitem", { name: "Unpin Status" });
      await expect(heldPin).toHaveAttribute("data-disabled");
      await expect(heldPin).toHaveAttribute(
        "title",
        "Status always keeps its place at the trailing edge",
      );
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
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
  A FLUSH SURFACE GETS A FLUSH TABLE, and it asks for one with `frame="flush"`. The money ledgers
  and the file manager's lists render the grid with no card around it, because the table meets the
  toolbar above it directly. It used to be spelled `rounded-none border-0` on the frame class,
  which gave those surfaces the PAINT and nothing else — and giving up the card changes more than
  the paint: the table has to fill the frame instead of ending where its rows end, and the last
  record has to KEEP the hairline a card's last row drops (the card's own bottom rule is what a
  carded table's last row is meeting, and a flush one has no such rule). The file list's last file
  was the one row in it with nothing underneath. Measured on the computed style, since a flush
  frame and a carded one look identical in markup.
-->
<Story
  name="Flush, with no card around it"
  args={{}}
  play={async ({ canvas, step }) => {
    const frame = canvas.getByRole("group", { name: "Time entries" });

    await step("The card the surface asked to lose is gone", async () => {
      const painted = globalThis.getComputedStyle(frame);
      await expect(painted.borderTopWidth).toBe("0px");
      await expect(painted.borderTopLeftRadius).toBe("0px");
    });

    await step("And it is still the scroll frame, holding its records", async () => {
      await expect(frame.scrollHeight).toBeGreaterThan(0);
      await expect(bodyRows(canvas.getByRole("table")).length).toBeGreaterThan(0);
    });
  }}
>
  {#snippet template()}
    <LitigationGrid frame="flush" frameClass="max-h-96" />
  {/snippet}
</Story>

<!--
  AND THE LAST RECORD OF A FLUSH TABLE KEEPS ITS HAIRLINE. This needs a table with NO TOTALS to
  say anything, which is why it is its own story: a totals strip already puts a filler row under
  the last record, so the record is not the body's last child and the card rule never reaches it.
  Without one, `:last-child` IS the last record — and dropping its hairline there left the last
  file in the matter's file list as the only row in the list with nothing between it and the space
  below. The card keeps that rule, because a card's own bottom rule runs a hairline under it.
-->
<Story
  name="Flush and short: the last record keeps its line"
  args={{}}
  play={async ({ canvas, step }) => {
    const lastRecordCell = (): Element => {
      const last = bodyRows(canvas.getByRole("table")).at(-1);
      if (last === undefined) throw new Error("the story rendered no records");
      const cell = last.querySelector(".mc-table-grid-cell");
      if (cell === null) throw new Error("the last record rendered no cells");
      return cell;
    };

    await step("There is no totals strip to hold the last row off the edge", async () => {
      await expect(canvas.getByRole("table").querySelector("tfoot")).toBeNull();
    });

    await step("The last record is separated from what is under it, like every other", async () => {
      await expect(globalThis.getComputedStyle(lastRecordCell()).borderBottomWidth).not.toBe("0px");
    });
  }}
>
  {#snippet template()}
    <LitigationGrid frame="flush" frameClass="max-h-96" columns={UNTOTALLED_COLUMNS} />
  {/snippet}
</Story>

<!--
  Empty (unfiltered): distinct from filtered-empty — nothing exists yet, nothing is hidden.

  AND IT DOES NOT LIGHT UP UNDER THE POINTER. The placeholder sits inside the table so the frame
  holds its height, which makes it a <tr> in the same body as the records, and the row hover found
  it there: an empty table answered the pointer with a grey band as tall as its message and no
  taller, leaving the surface below it white — a hover that appears to give out partway down the
  table. The fill means "this is a thing you can select and open" and there is nothing here to
  select, so the row carries `data-placeholder` and both the fill and the pointer cursor pass it
  over. What is asserted here is the cursor, which the same scoping decides and which needs no
  pointer to read; the fill itself answers only to a real one, and is checked in the running app.
  The record rows in the story above are the control for both.
-->
<Story
  name="Empty"
  args={{}}
  play={async ({ canvas, step }) => {
    await step("Says No Results, with the header intact", async () => {
      await expect(canvas.getByText("No Results")).toBeVisible();
      await expect(canvas.getByRole("button", { name: "Date" })).toBeVisible();
    });

    await step("The placeholder row is marked as holding no record", async () => {
      const placeholder = canvas.getByRole("group", { name: "Time entries" }).querySelector(
        "tbody tr",
      );
      await expect(placeholder).not.toBeNull();
      await expect(placeholder).toHaveAttribute("data-placeholder", "true");
    });

    await step("So it takes none of a record's treatment", async () => {
      const placeholder = canvas
        .getByRole("group", { name: "Time entries" })
        .querySelector("tbody tr") as HTMLElement;
      await expect(globalThis.getComputedStyle(placeholder).cursor).not.toBe("pointer");
    });
  }}
>
  {#snippet template()}
    <LitigationGrid rows={[]} />
  {/snippet}
</Story>

<!--
  The empty state CENTRES IN WHAT THE READER CAN SEE, not in the table.

  A placeholder row spans every column, so its cell is as wide as the table — and once a member has
  widened a couple of columns the table is far wider than its frame. Centred in the cell, the empty
  state's heading landed off past the inline end with its sentence trailing after it, on every
  surface whose columns overflow. This story reaches that state deliberately (fixed layout, columns
  summing well past the frame) and measures, because the defect is invisible to any assertion that
  only asks whether the text is in the document.
-->
<Story
  name="Empty in a table wider than its frame"
  args={{}}
  play={async ({ canvas, step }) => {
    const frame = canvas.getByRole("group", { name: "Time entries" });

    await step("The table really is wider than its frame", async () => {
      await waitFor(() => expect(frame.scrollWidth).toBeGreaterThan(frame.clientWidth + 200));
    });

    await step("The empty state sits centred in the frame, not in the table", async () => {
      const heading = canvas.getByText("No Results");
      await waitFor(() => {
        const frameBox = box(frame);
        const headingBox = box(heading);
        // Inside the frame at all — the defect put it wholly outside.
        expect(headingBox.start).toBeGreaterThanOrEqual(frameBox.start);
        expect(headingBox.end).toBeLessThanOrEqual(frameBox.end);
        // And centred on it, within a pixel of rounding.
        expect(Math.abs(headingBox.centre - frameBox.centre)).toBeLessThanOrEqual(1);
      });
    });

    await step("It holds its place when the table is scrolled sideways", async () => {
      frame.scrollLeft = 400;
      const heading = canvas.getByText("No Results");
      await waitFor(() => {
        const frameBox = box(frame);
        const headingBox = box(heading);
        expect(Math.abs(headingBox.centre - frameBox.centre)).toBeLessThanOrEqual(1);
      });
      frame.scrollLeft = 0;
    });
  }}
>
  {#snippet template()}
    <LitigationGrid rows={[]} columnWidths={OVERWIDE_COLUMN_WIDTHS} />
  {/snippet}
</Story>


<!--
  AND IT IS STILL CENTRED ON A TABLE THAT CAN MARK ITS ROWS.

  A table that marks rows reserves the mark's gutter on every first cell, so that marking one lights
  a glyph and shifts nothing. A placeholder's cell is not a row's, and it drops the cell's own inset
  precisely so the empty state can centre in the frame — so the gutter has to come off it too. Left
  on, it displaced the state by the whole gutter rather than half, because the frame inside the cell
  takes a fixed width rather than filling it: 24px out, on every table in the product that declares
  a rowMark at all, marked or not. The story above cannot see this — its grid declares no marks —
  and the file manager's list declares them on every view it has.
-->
<Story
  name="Empty in a table wider than its frame, with row marks"
  args={{}}
  play={async ({ canvas, step }) => {
    const frame = canvas.getByRole("group", { name: "Time entries" });

    await step("The table reserves the mark's gutter", async () => {
      await expect(canvas.getByRole("table")).toHaveAttribute("data-row-marks", "on");
    });

    await step("And the empty state is still centred in the frame", async () => {
      const heading = canvas.getByText("No Results");
      await waitFor(() => {
        const frameBox = box(frame);
        const headingBox = box(heading);
        expect(Math.abs(headingBox.centre - frameBox.centre)).toBeLessThanOrEqual(1);
      });
    });
  }}
>
  {#snippet template()}
    <LitigationGrid
      rows={[]}
      columnWidths={OVERWIDE_COLUMN_WIDTHS}
      rowMark={() => ({ pinned: false })}
    />
  {/snippet}
</Story>

<!--
  The totals strip is held at the BOTTOM of the frame, not left wherever the last row ended.

  A ledger fills the height it is given, so the ordinary case is a table with room beneath it. The
  strip is sticky, and sticky does nothing while there is nothing below to scroll past — so a table
  shorter than its frame used to leave its totals just under the last row with a band of blank
  surface beneath them. This story is that exact shape — one record in a frame with room for
  several — and it measures the result rather than trusting the eye.
-->
<Story
  name="Totals held at the bottom of the frame"
  args={{}}
  play={async ({ canvas, step }) => {
    const frame = canvas.getByRole("group", { name: "Time entries" });
    const table = canvas.getByRole("table");
    const totalsRow = table.querySelector("tfoot tr:last-child");
    if (totalsRow === null) throw new Error("the totals row did not render");

    await step("There is real slack between the last record and the totals", async () => {
      const record = table.querySelector("tbody tr[data-grid-row]");
      if (record === null) throw new Error("the record row did not render");
      await expect(table.querySelectorAll("tbody tr[data-grid-row]").length).toBe(1);
      // The condition the whole fix is about, measured: a gap the filler row is holding open.
      // Without it the strip would begin where this record ends, and the gap would be zero.
      const gap = totalsRow.getBoundingClientRect().top - record.getBoundingClientRect().bottom;
      await expect(gap).toBeGreaterThan(100);
    });

    await step("The totals sit on the frame's own bottom edge", async () => {
      const frameBottom = frame.getBoundingClientRect().bottom;
      const totalsBottom = totalsRow.getBoundingClientRect().bottom;
      // Within a couple of pixels, allowing for the frame's hairline border.
      await expect(Math.abs(frameBottom - totalsBottom)).toBeLessThanOrEqual(2);
    });

    await step("The record keeps its own height rather than stretching to fill", async () => {
      const record = table.querySelector("tbody tr[data-grid-row]");
      if (record === null) throw new Error("the record row did not render");
      // The slack goes to the filler row. Had table layout shared it out instead, this single row
      // would have taken most of the frame.
      await expect(record.getBoundingClientRect().height).toBeLessThan(60);
    });

    await step("The scenery row counts as scenery, not as a record", async () => {
      // It has to live in the body for the layout to work at all, so it says what it is instead:
      // no `data-grid-row`, which is the mark every count of real rows filters on, and hidden from
      // assistive technology so nobody is told about an empty row.
      const filler = table.querySelector(".mc-table-grid-filler-row");
      await expect(filler).not.toBeNull();
      await expect(filler).toHaveAttribute("aria-hidden", "true");
      await expect(filler).not.toHaveAttribute("data-grid-row");
      await expect(table.querySelectorAll("tbody tr[data-grid-row]").length).toBe(1);
    });
  }}
>
  {#snippet template()}
    <LitigationGrid rows={TIME_ENTRIES.slice(0, 1)} frameClass="min-h-0 flex-1" frameHeight="320px" />
  {/snippet}
</Story>


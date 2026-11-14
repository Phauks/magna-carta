<script module lang="ts">
  /*
   * DatePicker — a date typed the way it is said ("Nov 13", "11/13", "today", "fri") or picked from
   * a popover calendar, shown in words with its weekday once the field is left. Holds a date VALUE,
   * so it is an Input (catalog taxonomy). The reading of typed text is `typed-date.ts`, tested on its
   * own; these stories prove the field around it. Values are @internationalized/date CalendarDate; a
   * fixed placeholder month keeps the story deterministic for the visual-regression matrix.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import { CalendarDate } from "@internationalized/date";
  import { DatePicker } from "../lib/components/date-picker/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/DatePicker",
    component: DatePicker,
    args: { label: "Closing date" },
    argTypes: { size: { control: "select", options: ["sm", "default", "lg"] } },
    parameters: {
      controls: { include: ["label", "size", "disabled"] },
    },
  });

  type DatePickerStoryArgs = ComponentProps<typeof DatePicker>;

  const JUNE_2026 = new CalendarDate(2026, 6, 1);
  // The "no past dates" floor. Fixed here for a deterministic story; in production pass
  // today(getLocalTimeZone()) so every date before today is disabled.
  const MINIMUM = new CalendarDate(2026, 6, 16);
  // An "earliest possible date" floor for a birthdate: no one in use was born before 1900. minValue
  // both blocks earlier (bad) dates and floors the year dropdown; maxValue caps it.
  const BIRTH_FLOOR = new CalendarDate(1900, 1, 1);
  const BIRTH_CEILING = new CalendarDate(2026, 6, 16);
  const YEAR_2000 = new CalendarDate(2000, 1, 1);
</script>

<Story
  name="Single"
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const field = canvas.getByRole("textbox", { name: "Closing date" });

    await step("Renders the labelled date field", async () => {
      await expect(canvas.getByText("Closing date")).toBeVisible();
      await expect(field).toBeVisible();
    });

    await step("A typed date is read and shown in words when the field is left", async () => {
      await userEvent.click(field);
      await userEvent.type(field, "6/15/2026");
      await userEvent.tab();
      await expect(field).toHaveValue("Mon, Jun 15, 2026");
    });

    await step("Text that names no day is refused with a red edge, and Escape puts it back", async () => {
      await userEvent.clear(field);
      await userEvent.type(field, "soon{Enter}");
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field.title).toMatch(/Not a date/);
      await userEvent.keyboard("{Escape}");
      await expect(field).toHaveValue("Mon, Jun 15, 2026");
      await expect(field).not.toHaveAttribute("aria-invalid");
    });

    await step("Up and Down move a day", async () => {
      await userEvent.keyboard("{ArrowUp}");
      await expect(field).toHaveValue("Tue, Jun 16, 2026");
      await userEvent.keyboard("{ArrowDown}{ArrowDown}");
      await expect(field).toHaveValue("Sun, Jun 14, 2026");
    });

    await step("Picking a day in the calendar fills the field and closes the calendar", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Open calendar" }));
      const grid = within(await body.findByRole("grid"));
      await userEvent.click(grid.getByText("20"));
      await waitFor(() => expect(body.queryByRole("grid")).toBeNull());
      await expect(field).toHaveValue("Sat, Jun 20, 2026");
      await expect(field).toHaveFocus();
    });

    await step("Clearing the box clears the date", async () => {
      await userEvent.clear(field);
      await userEvent.tab();
      await expect(field).toHaveValue("");
    });
  }}
>
  {#snippet template(args: DatePickerStoryArgs)}
    <div class="max-w-xs">
      <DatePicker {...args} placeholder={JUNE_2026} />
    </div>
  {/snippet}
</Story>

<!-- The "no past dates" setting: minValue disables every earlier date. Pass today() in production. -->
<Story
  name="No past dates"
  args={{ label: "Deadline" }}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("Opens the calendar", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Open calendar" }));
      await body.findByRole("grid");
    });

    await step("Dates before the minimum are disabled; the minimum onward is selectable", async () => {
      const grid = within(body.getByRole("grid"));
      await expect(grid.getByText("5")).toHaveAttribute("data-disabled");
      await expect(grid.getByText("20")).not.toHaveAttribute("data-disabled");
      await userEvent.click(grid.getByText("20"));
      await waitFor(() => expect(body.queryByRole("grid")).toBeNull());
      await expect(canvas.getByRole("textbox", { name: "Deadline" })).toHaveValue(
        "Sat, Jun 20, 2026",
      );
    });

    await step("A typed date before the minimum is refused", async () => {
      const field = canvas.getByRole("textbox", { name: "Deadline" });
      await userEvent.clear(field);
      await userEvent.type(field, "6/5/2026{Enter}");
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field.title).toMatch(/earliest date allowed/);
    });
  }}
>
  {#snippet template(args: DatePickerStoryArgs)}
    <div class="max-w-xs">
      <DatePicker {...args} placeholder={JUNE_2026} minValue={MINIMUM} />
    </div>
  {/snippet}
</Story>

<!-- Earliest-date floor + year jump: the year dropdown is bounded by minValue/maxValue, so a far-back
     birthdate is reachable in one pick and impossible dates (pre-1900) are never offered. -->
<Story
  name="Date of birth"
  args={{ label: "Date of birth" }}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("Opens at the placeholder year", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Open calendar" }));
      await body.findByRole("grid");
      // The popover scale-fades in, so poll until the entrance settles.
      await waitFor(() => expect(body.getByDisplayValue("2000")).toBeVisible());
    });

    await step("The year dropdown is floored at the earliest allowed year", async () => {
      const yearSelect = within(body.getByRole("combobox", { name: "Year" }));
      await expect(yearSelect.getByText("1900")).toBeInTheDocument();
      await expect(yearSelect.queryByText("1899")).toBeNull();
    });

    await step("Jumping to a far-back year via the select navigates the calendar", async () => {
      await userEvent.selectOptions(body.getByRole("combobox", { name: "Year" }), "1950");
      await waitFor(() => expect(body.getByDisplayValue("1950")).toBeVisible());
    });
  }}
>
  {#snippet template(args: DatePickerStoryArgs)}
    <div class="max-w-xs">
      <DatePicker {...args} placeholder={YEAR_2000} minValue={BIRTH_FLOOR} maxValue={BIRTH_CEILING} />
    </div>
  {/snippet}
</Story>

<!-- Named without a visible label. Where a surface has no room for one — the data table's
     per-column From/To range, two fields inside a menu — `aria-label` names the input instead. -->
<Story
  name="Named without a label"
  args={{ label: undefined, size: "sm" }}
  play={async ({ canvas, step }) => {
    await step("The field carries its name with no label rendered", async () => {
      await expect(canvas.getByRole("textbox", { name: "From" })).toBeVisible();
      await expect(canvas.queryByText("From")).toBeNull();
    });

    await step("The compact size is the Input's own, so the two can share a row", async () => {
      await expect(canvas.getByRole("textbox", { name: "From" }).parentElement).toHaveClass(
        "mc-date-field-sm",
      );
    });
  }}
>
  {#snippet template(args: DatePickerStoryArgs)}
    <div class="max-w-xs">
      <DatePicker {...args} aria-label="From" placeholder={JUNE_2026} />
    </div>
  {/snippet}
</Story>

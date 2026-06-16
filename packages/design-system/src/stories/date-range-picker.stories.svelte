<script module lang="ts">
  /*
   * DateRangePicker — Tier 4 (Bits UI), composition-heavy: two segmented date fields (start + end)
   * with a popover range calendar. Holds a {start, end} range VALUE, so it is an Input (catalog
   * taxonomy). Bits owns segment editing, the range selection + in-range highlight, the popover, and
   * the a11y; the calendar reuses the mc-calendar-* recipes plus the range day states. Values are
   * @internationalized/date CalendarDate; a fixed placeholder month keeps the story deterministic.
   * svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import { CalendarDate } from "@internationalized/date";
  import { DateRangePicker } from "../lib/components/date-range-picker/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/DateRangePicker",
    component: DateRangePicker,
    args: { label: "Engagement period" },
    parameters: {
      controls: { include: ["label"] },
    },
  });

  type DateRangePickerStoryArgs = ComponentProps<typeof DateRangePicker>;

  const JUNE_2026 = new CalendarDate(2026, 6, 1);
</script>

<Story
  name="Range"
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("Renders the labelled range field", async () => {
      await expect(canvas.getByText("Engagement period")).toBeVisible();
    });

    await step("The trigger opens the calendar", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Open calendar" }));
      await body.findByRole("grid");
    });

    await step("Selecting a start then an end day marks the range", async () => {
      const grid = body.getByRole("grid");
      await userEvent.click(within(grid).getByText("10"));
      await userEvent.click(within(grid).getByText("15"));
      await waitFor(() =>
        expect(within(grid).getByText("10")).toHaveAttribute("data-selection-start"),
      );
      await expect(within(grid).getByText("15")).toHaveAttribute("data-selection-end");
    });

    await step("The calendar stays open after a complete range, so it can be adjusted", async () => {
      await expect(body.queryByRole("grid")).not.toBeNull();
    });
  }}
>
  {#snippet template(args: DateRangePickerStoryArgs)}
    <div class="max-w-sm">
      <DateRangePicker {...args} placeholder={JUNE_2026} />
    </div>
  {/snippet}
</Story>

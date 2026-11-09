<script module lang="ts">
  /*
   * Calendar — Tier 4 (Bits UI). A month grid that holds a date VALUE, so it is an Input (catalog
   * taxonomy). Bits owns the date math, the grid a11y (role="grid", gridcells), keyboard navigation
   * (arrow keys move the focused day, PageUp/Down change months), and disabled-date logic; our recipe
   * dresses the day states. Values are @internationalized/date CalendarDate (the civil date). A fixed
   * placeholder month keeps the story deterministic for the visual-regression matrix. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, within } from "storybook/test";
  import { CalendarDate } from "@internationalized/date";
  import { Calendar } from "../lib/components/calendar/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/Calendar",
    component: Calendar,
    args: { type: "single" },
    parameters: {
      controls: { include: ["readonly"] },
    },
  });

  type CalendarStoryArgs = ComponentProps<typeof Calendar>;

  const JUNE_2026 = new CalendarDate(2026, 6, 1);
  // Disable the 20th to show the disabled day state.
  const isTwentieth = (date: { day: number }): boolean => date.day === 20;
</script>

<Story
  name="Single"
  play={async ({ canvas, step }) => {
    const grid = within(canvas.getByRole("grid"));

    await step("Renders the placeholder month with jump-to month/year selects", async () => {
      await expect(canvas.getByDisplayValue("June")).toBeVisible();
      await expect(canvas.getByDisplayValue("2026")).toBeVisible();
      await expect(grid.getByText("15")).toBeVisible();
    });

    await step("A disabled date is not selectable", async () => {
      const twentieth = grid.getByText("20");
      await expect(twentieth).toHaveAttribute("data-disabled");
      await userEvent.click(twentieth, { pointerEventsCheck: 0 });
      await expect(twentieth).not.toHaveAttribute("data-selected");
    });

    await step("Clicking a day selects it", async () => {
      const fifteenth = grid.getByText("15");
      await userEvent.click(fifteenth);
      await expect(fifteenth).toHaveAttribute("data-selected");
    });

    await step("ArrowRight moves the focused day", async () => {
      await userEvent.keyboard("{ArrowRight}");
      await expect(grid.getByText("16")).toHaveFocus();
    });

    await step("The next-month button advances the month select", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Next" }));
      await expect(canvas.getByDisplayValue("July")).toBeVisible();
    });
  }}
>
  {#snippet template(args: CalendarStoryArgs)}
    <Calendar {...args} placeholder={JUNE_2026} isDateDisabled={isTwentieth} />
  {/snippet}
</Story>

<!--
  Compact: the month a column pins under a list. No frame, smaller days, and the month named in
  words; pressing the name opens MonthJump, twelve months a year at a time.
-->
<Story
  name="Compact"
  play={async ({ canvas, step }) => {
    await step("Names the month in words, with no month or year select", async () => {
      await expect(canvas.getByRole("button", { name: "Choose a month" })).toHaveTextContent(
        "June 2026",
      );
      await expect(canvas.queryByDisplayValue("June")).toBeNull();
    });

    await step("The next-month button moves the named month", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Next" }));
      await expect(canvas.getByRole("button", { name: "Choose a month" })).toHaveTextContent(
        "July 2026",
      );
    });
  }}
>
  {#snippet template(args: CalendarStoryArgs)}
    <Calendar {...args} density="compact" placeholder={JUNE_2026} />
  {/snippet}
</Story>

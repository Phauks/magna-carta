<script module lang="ts">
  /*
   * DateTimeField — one field for a day, a time of day, or both: the segments are typed into one
   * box, and its button opens one panel holding the month and a list of times. One story per
   * `mode`, the component's variant axis. A fixed day keeps the stories deterministic for the
   * visual-regression matrix.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import { CalendarDate } from "@internationalized/date";
  import { DateTimeField } from "../lib/components/date-time-field/index.ts";

  const { Story } = defineMeta({
    title: "Compound Inputs/DateTimeField",
    component: DateTimeField,
    args: { label: "Starts", allowNoTime: false, noTimeLabel: "No time", timeStep: 15 },
    argTypes: { size: { control: "select", options: ["sm", "default", "lg"] } },
    parameters: {
      controls: {
        include: ["label", "size", "disabled", "allowNoTime", "noTimeLabel", "timeStep", "zoneLabel"],
      },
    },
  });

  type DateTimeFieldStoryArgs = ComponentProps<typeof DateTimeField>;

  const HEARING_DAY = new CalendarDate(2026, 11, 16);
</script>

<script lang="ts">
  let bothDate = $state<CalendarDate | undefined>(HEARING_DAY);
  let bothTime = $state("09:40");
  let bothNoTime = $state(false);
  let dayOnly = $state<CalendarDate | undefined>(HEARING_DAY);
  let timeOnly = $state("14:00");
</script>

<Story
  name="Date and time"
  args={{ allowNoTime: true, noTimeLabel: "All day", zoneLabel: "PST" }}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("Shows the day and the time in one labelled field", async () => {
      await expect(canvas.getByText("Starts")).toBeVisible();
      await expect(canvas.getByRole("group", { name: "Starts" })).toHaveTextContent("2026");
      await expect(canvas.getByRole("group", { name: "Starts, time" })).toBeVisible();
    });

    await step("The button opens the month and the times together", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Choose a day and time" }));
      await body.findByRole("grid");
      await waitFor(() => expect(body.getByRole("group", { name: "Times" })).toBeVisible());
    });

    await step("A time off the fifteen-minute step is in the list and marked", async () => {
      const times = within(body.getByRole("group", { name: "Times" }));
      await expect(times.getByRole("button", { name: "9:40 AM" })).toHaveAttribute(
        "aria-current",
        "true",
      );
    });

    await step("Choosing All Day replaces the time and closes the panel", async () => {
      const times = within(body.getByRole("group", { name: "Times" }));
      await userEvent.click(times.getByRole("button", { name: "All day" }));
      await waitFor(() => expect(body.queryByRole("grid")).toBeNull());
      await expect(canvas.getByText("All day")).toBeVisible();
    });
  }}
>
  {#snippet template(args: DateTimeFieldStoryArgs)}
    <div class="max-w-sm">
      <DateTimeField
        {...args}
        mode="date-time"
        date={bothDate}
        onDateChange={(next) => (bothDate = next as CalendarDate | undefined)}
        bind:time={bothTime}
        bind:noTime={bothNoTime}
      />
    </div>
  {/snippet}
</Story>

<Story
  name="Date"
  args={{ label: "Filing date" }}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("Asks for a day alone", async () => {
      await expect(canvas.getByRole("group", { name: "Filing date" })).toHaveTextContent("2026");
      await expect(canvas.queryByRole("group", { name: "Filing date, time" })).toBeNull();
    });

    await step("The panel is the month alone, and a day closes it", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Open calendar" }));
      const grid = within(await body.findByRole("grid"));
      await expect(body.queryByRole("group", { name: "Times" })).toBeNull();
      await userEvent.click(grid.getByText("18"));
      await waitFor(() => expect(body.queryByRole("grid")).toBeNull());
    });
  }}
>
  {#snippet template(args: DateTimeFieldStoryArgs)}
    <div class="max-w-sm">
      <DateTimeField
        {...args}
        mode="date"
        date={dayOnly}
        onDateChange={(next) => (dayOnly = next as CalendarDate | undefined)}
      />
    </div>
  {/snippet}
</Story>

<Story
  name="Time"
  args={{ label: "Reminder at" }}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("The panel is the list of times alone", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Choose a time" }));
      const times = within(await body.findByRole("group", { name: "Times" }));
      await expect(body.queryByRole("grid")).toBeNull();
      await userEvent.click(times.getByRole("button", { name: "3:15 PM" }));
      await waitFor(() => expect(body.queryByRole("group", { name: "Times" })).toBeNull());
    });
  }}
>
  {#snippet template(args: DateTimeFieldStoryArgs)}
    <div class="max-w-sm">
      <DateTimeField {...args} mode="time" bind:time={timeOnly} />
    </div>
  {/snippet}
</Story>

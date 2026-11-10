<script module lang="ts">
  /*
   * CalendarGrid — a month, a week and an agenda over one domain-free entry shape.
   *
   * The stories are the states a real calendar passes through: a dense month with a day that has
   * to fold, a span crossing a week boundary, a struck entry and today marked; the same month
   * empty, loading, and beginning on Monday; a week and its loading state; an agenda over two
   * weeks, empty, and loading. The fixture's words are just strings — "Hearing", "Response due",
   * "Firm meeting" — because the whole claim of the family is that it does not know what they mean.
   *
   * Every story pins the locale to en-US and hands the grid a fixed today. The component's own
   * defaults are the VIEWER's locale and no today at all, which is the rule; pinning here is what
   * makes the catalog and its assertions read the same on every machine.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, fn, userEvent, within } from "storybook/test";
  import type { ComponentProps } from "svelte";
  import * as CalendarGrid from "../lib/components/calendar-grid/index.ts";
  import CalendarGridMonth from "../lib/components/calendar-grid/calendar-grid-month.svelte";
  import type { CalendarGridEntry } from "../lib/components/calendar-grid/index.ts";
  import { formatCivilDateLong, parseCivilDate } from "../lib/components/calendar-grid/civil-date.ts";

  const { Story } = defineMeta({
    title: "Data Display/CalendarGrid",
    component: CalendarGridMonth,
    parameters: {
      controls: {
        include: [
          "entries",
          "label",
          "anchor",
          "weekStartsOn",
          "today",
          "loading",
          "loadingMessage",
          "emptyMessage",
          "maxEntriesPerDay",
          "locale",
        ],
      },
    },
    argTypes: {
      weekStartsOn: { control: "select", options: [0, 1] },
    },
  });

  type MonthStoryArgs = ComponentProps<typeof CalendarGridMonth>;

  const activate = fn();

  /*
   * The agenda heading. The grid's OWN formatter, pinned to en-US so the story renders the same
   * words on every machine — a story that formatted the day itself would be showing something the
   * component does not do, which is the one thing a catalog entry must never do.
   */
  const pinnedDayHeading = (date: string): string =>
    formatCivilDateLong(parseCivilDate(date), "en-US");

  /*
   * The Day's fixture: one Tuesday across three calendars. Two attorneys and a room, because that
   * is the shape the Day exists for — the same deposition on Ada's column and the Boardroom's is
   * ONE deposition on two calendars, and drawing it twice is the point rather than a defect.
   *
   * The minute a thing starts at is a NUMBER here, separate from the formatted time: which zone a
   * time is stated in is a fact about the domain, and a grid that read a number back out of "9:00
   * AM" would be guessing at one.
   */
  const DAY_LANES = [
    { key: "ada", label: "Ada Lovelace", color: "green" as const },
    { key: "grace", label: "Grace Hopper", color: "blue" as const },
    { key: "boardroom", label: "Boardroom", color: "orange" as const },
  ];

  const DAY_ENTRIES: readonly CalendarGridEntry[] = [
    {
      id: "ada|response-due",
      lane: "ada",
      date: "2026-09-15",
      label: "Response due",
      detail: "2026-00354",
      tone: "warning",
      color: "green",
    },
    {
      id: "ada|deposition",
      lane: "ada",
      date: "2026-09-15",
      label: "Deposition",
      detail: "2026-00412",
      time: "9:00 AM",
      startMinute: 540,
      endMinute: 660,
      tone: "info",
      color: "green",
    },
    {
      id: "boardroom|deposition",
      lane: "boardroom",
      date: "2026-09-15",
      label: "Deposition",
      detail: "2026-00412",
      time: "9:00 AM",
      startMinute: 540,
      endMinute: 660,
      tone: "info",
      color: "orange",
    },
    {
      id: "grace|early-call",
      lane: "grace",
      date: "2026-09-15",
      label: "Client call",
      detail: "2026-00377",
      time: "6:30 AM",
      startMinute: 390,
      tone: "neutral",
      color: "blue",
    },
    {
      id: "grace|settlement",
      lane: "grace",
      date: "2026-09-15",
      label: "Settlement conference",
      detail: "2026-00377",
      time: "2:00 PM",
      startMinute: 840,
      tone: "info",
      color: "blue",
    },
  ];

  /*
   * A morning with three settings running over each other, and a fourth that only begins when the
   * longest of them ends. It is the fixture the two concurrency presentations are read against:
   * the three share their column, and the fourth takes it back whole, because back-to-back is not
   * concurrent and a column divided for it would be divided all day.
   */
  const CROWDED_MORNING: readonly CalendarGridEntry[] = [
    {
      id: "deposition",
      date: "2026-09-15",
      label: "Deposition",
      detail: "2026-00412",
      time: "9:00 AM",
      startMinute: 540,
      endMinute: 720,
      tone: "info",
    },
    {
      id: "status",
      date: "2026-09-15",
      label: "Status conference",
      detail: "2026-00354",
      time: "9:30 AM",
      startMinute: 570,
      endMinute: 630,
      tone: "info",
    },
    {
      id: "call",
      date: "2026-09-15",
      label: "Client call",
      detail: "2026-00377",
      time: "10:00 AM",
      startMinute: 600,
      endMinute: 660,
      tone: "neutral",
    },
    {
      id: "afternoon",
      date: "2026-09-15",
      label: "Settlement conference",
      detail: "2026-00377",
      time: "12:00 PM",
      startMinute: 720,
      endMinute: 840,
      tone: "info",
    },
  ];

  // September 2026 begins on a Tuesday. The 15th carries six entries so the month folds it; the
  // trial runs Friday to Sunday, across the Sunday-start week boundary; the hearing on the 22nd
  // was called off and is struck; the 29th's entry goes somewhere, so it is a link.
  const SEPTEMBER: readonly CalendarGridEntry[] = [
    {
      id: "hearing-2",
      date: "2026-09-02",
      label: "Hearing",
      detail: "2026-00412",
      time: "9:30 AM",
      tone: "info",
    },
    {
      id: "response-due-4",
      date: "2026-09-04",
      label: "Response due",
      detail: "2026-00398",
      tone: "danger",
    },
    {
      id: "firm-meeting-8",
      date: "2026-09-08",
      label: "Firm meeting",
      detail: "Everyone",
      time: "8:30 AM",
      tone: "accent",
    },
    {
      id: "trial-11",
      date: "2026-09-11",
      endDate: "2026-09-13",
      label: "Trial",
      detail: "2026-00377",
      time: "9:00 AM",
      tone: "info",
    },
    {
      id: "deposition-15",
      date: "2026-09-15",
      label: "Deposition",
      detail: "2026-00412",
      time: "9:00 AM",
      tone: "info",
    },
    {
      id: "response-due-15",
      date: "2026-09-15",
      label: "Response due",
      detail: "2026-00354",
      tone: "warning",
    },
    {
      id: "conference-15",
      date: "2026-09-15",
      label: "Conference",
      detail: "2026-00377",
      time: "11:00 AM",
      tone: "neutral",
    },
    {
      id: "filing-due-15",
      date: "2026-09-15",
      label: "Filing due",
      detail: "2026-00398",
      tone: "danger",
    },
    {
      id: "client-call-15",
      date: "2026-09-15",
      label: "Client call",
      detail: "2026-00412",
      time: "2:00 PM",
      tone: "neutral",
    },
    {
      id: "firm-meeting-15",
      date: "2026-09-15",
      label: "Firm meeting",
      detail: "Everyone",
      time: "4:00 PM",
      tone: "accent",
    },
    {
      id: "hearing-22",
      date: "2026-09-22",
      label: "Hearing",
      detail: "2026-00401",
      time: "10:00 AM",
      tone: "warning",
      struck: true,
    },
    {
      id: "served-25",
      date: "2026-09-25",
      label: "Discovery served",
      detail: "2026-00377",
      tone: "success",
    },
    {
      id: "mediation-29",
      date: "2026-09-29",
      label: "Mediation",
      detail: "2026-00354",
      time: "1:00 PM",
      tone: "neutral",
      href: "#mediation",
    },
  ];

  const TODAY = "2026-09-02";
  const DENSE_DAY_HEADING = "Tuesday, September 15, 2026";
</script>

{#snippet monthDense(args: MonthStoryArgs)}
  <CalendarGrid.Month {...args} onActivate={activate} />
{/snippet}

<Story
  name="MonthDense"
  template={monthDense}
  args={{
    entries: SEPTEMBER,
    label: "Firm calendar",
    anchor: "2026-09-01",
    today: TODAY,
    locale: "en-US",
    emptyMessage: "Nothing recorded in September 2026",
  }}
  play={async ({ canvas, canvasElement, step }) => {
    const table = canvas.getByRole("table", { name: "Firm calendar" });

    await step("Every row is a whole week, headed by the weekday", async () => {
      const heads = canvas.getAllByRole("columnheader");
      await expect(heads).toHaveLength(7);
      await expect(heads[0]).toHaveTextContent("Sun");
      await expect(canvas.getAllByRole("cell")).toHaveLength(35);
    });

    await step("A day past the cap folds behind a control that reports the hidden count", async () => {
      const more = canvas.getByRole("button", { name: `Show 3 more on ${DENSE_DAY_HEADING}` });
      await expect(more).toHaveTextContent("+3 more");
      const cell = more.closest("td");
      await expect(cell).not.toBeNull();
      await expect(within(cell as HTMLElement).getAllByRole("listitem")).toHaveLength(3);
    });

    await step("A struck entry is shown, marked struck, and says so to a reader", async () => {
      const struck = canvas.getByRole("button", { name: /^10:00 AM Hearing struck through$/ });
      await expect(struck).toHaveAttribute("data-struck", "true");
    });

    await step("Exactly one cell is today, and it is the second", async () => {
      const todayCells = canvasElement.querySelectorAll('td[data-today="true"]');
      await expect(todayCells).toHaveLength(1);
      await expect(todayCells[0]).toHaveTextContent("Wednesday, September 2, 2026, today");
    });

    await step("A span appears on each of its three days, marked at its ends", async () => {
      const days = canvas.getAllByRole("button", { name: /Trial/ });
      await expect(days).toHaveLength(3);
      await expect(days[0]).toHaveAttribute("data-span-start", "true");
      await expect(days[0]).not.toHaveAttribute("data-span-end");
      await expect(days[1]).not.toHaveAttribute("data-span-start");
      await expect(days[1]).not.toHaveAttribute("data-span-end");
      await expect(days[2]).toHaveAttribute("data-span-end", "true");
      await expect(days[0]?.closest("td")).toHaveTextContent("Friday, September 11, 2026");
      await expect(days[2]?.closest("td")).toHaveTextContent("Sunday, September 13, 2026");
    });

    await step("The neighbouring months' days are present and marked outside the month", async () => {
      const outside = canvasElement.querySelectorAll('td[data-outside-month="true"]');
      await expect(outside).toHaveLength(5);
      await expect(outside[0]).toHaveTextContent("Sunday, August 30, 2026");
    });

    await step("Activating an entry hands it back to the caller", async () => {
      activate.mockClear();
      await userEvent.click(canvas.getByRole("button", { name: "9:30 AM Hearing" }));
      await expect(activate).toHaveBeenCalledTimes(1);
      await expect(activate).toHaveBeenLastCalledWith(SEPTEMBER[0]);
    });

    await step("An entry that goes somewhere is a link", async () => {
      await expect(canvas.getByRole("link", { name: "1:00 PM Mediation" })).toHaveAttribute(
        "href",
        "#mediation",
      );
    });

    await step("The grid is not busy and its caption line is mounted, blank", async () => {
      await expect(table).not.toHaveAttribute("aria-busy");
      await expect(canvas.queryByText("Nothing recorded in September 2026")).toBeNull();
    });
  }}
/>

{#snippet monthEmpty()}
  <CalendarGrid.Month
    entries={[]}
    label="Firm calendar"
    anchor="2026-09-01"
    today={TODAY}
    locale="en-US"
    emptyMessage="Nothing recorded in September 2026"
  />
{/snippet}

<Story
  name="MonthEmpty"
  template={monthEmpty}
  play={async ({ canvas, step }) => {
    await step("The empty month is the same grid, with the statement in the caption", async () => {
      await expect(canvas.getByRole("table", { name: "Firm calendar" })).toBeVisible();
      await expect(canvas.getAllByRole("cell")).toHaveLength(35);
      await expect(canvas.getByText("Nothing recorded in September 2026")).toBeVisible();
      await expect(canvas.queryByRole("listitem")).toBeNull();
    });
  }}
/>

{#snippet monthLoading()}
  <CalendarGrid.Month
    entries={[]}
    label="Firm calendar"
    anchor="2026-09-01"
    today={TODAY}
    locale="en-US"
    loading
  />
{/snippet}

<Story
  name="MonthLoading"
  template={monthLoading}
  play={async ({ canvas, step }) => {
    await step("The grid reports itself busy while the entries are fetched", async () => {
      await expect(canvas.getByRole("table", { name: "Firm calendar" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    });

    await step("A reader is told it is loading, not left with silent placeholders", async () => {
      await expect(canvas.getByText("Loading the calendar")).toBeInTheDocument();
      await expect(canvas.queryByRole("listitem")).toBeNull();
    });
  }}
/>

{#snippet monthMondayStart()}
  <CalendarGrid.Month
    entries={SEPTEMBER}
    label="Firm calendar"
    anchor="2026-09-01"
    today={TODAY}
    weekStartsOn={1}
    locale="en-US"
    emptyMessage="Nothing recorded in September 2026"
  />
{/snippet}

<Story
  name="MonthMondayStart"
  template={monthMondayStart}
  play={async ({ canvas, canvasElement, step }) => {
    await step("A Monday-start month heads its first column Mon and its last Sun", async () => {
      const heads = canvas.getAllByRole("columnheader");
      await expect(heads[0]).toHaveTextContent("Mon");
      await expect(heads[6]).toHaveTextContent("Sun");
    });

    await step("The span no longer crosses a row, and today is still one cell", async () => {
      await expect(canvas.getAllByRole("button", { name: /Trial/ })).toHaveLength(3);
      await expect(canvasElement.querySelectorAll('td[data-today="true"]')).toHaveLength(1);
    });
  }}
/>

<!--
  The Week. A TIME GRID since the owner's 2026-09-14 round: seven day columns over an hour axis,
  where every timed entry is a block from its start to its end and what is true of a whole day sits
  in the band above the hours. The fixture is the month's own entries, which is the point — the same
  domain-free shape reads as a month of cells or as a week of hours depending only on the grid.
-->
{#snippet week()}
  <!-- A week of hours is taller than the frame it is read in, so the story scrolls it — wearing
       the house scrollbar, as every scroll region in the product does. -->
  <div class="mc-scrollbar h-96 overflow-auto">
    <CalendarGrid.Week
      entries={SEPTEMBER}
      label="Firm calendar"
      anchor="2026-09-15"
      today="2026-09-15"
      locale="en-US"
      emptyMessage="Nothing recorded this week"
      onActivate={activate}
    />
  </div>
{/snippet}

<Story
  name="Week"
  template={week}
  play={async ({ canvas, canvasElement, step }) => {
    await step("Seven days across, and the time gutter that heads the hours", async () => {
      await expect(canvas.getAllByRole("columnheader")).toHaveLength(8);
    });

    await step("A span reaching into the week from before it is marked only at its end", async () => {
      // A multi-day run has no hour, so it sits in the all-day band, where spans are still drawn
      // across their days and marked at each end.
      const trial = canvas.getByRole("button", { name: /Trial/ });
      await expect(trial).toHaveAttribute("data-span-end", "true");
      await expect(trial).not.toHaveAttribute("data-span-start");
    });

    await step("Today is a column, not a cell", async () => {
      await expect(canvasElement.querySelectorAll('th[data-today="true"]')).toHaveLength(1);
    });
  }}
/>

{#snippet weekLoading()}
  <CalendarGrid.Week
    entries={[]}
    label="Firm calendar"
    anchor="2026-09-15"
    locale="en-US"
    loading
  />
{/snippet}

<Story
  name="WeekLoading"
  template={weekLoading}
  play={async ({ canvas, step }) => {
    await step("The week reports itself busy and says it is loading", async () => {
      await expect(canvas.getByRole("table", { name: "Firm calendar" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(canvas.getByText("Loading the calendar")).toBeInTheDocument();
    });
  }}
/>

{#snippet agenda()}
  <div class="h-96 max-w-xl">
    <CalendarGrid.Agenda
      entries={SEPTEMBER}
      label="Coming up"
      from="2026-09-07"
      to="2026-09-20"
      formatDayHeading={pinnedDayHeading}
      emptyMessage="Nothing recorded between September 7 and September 20, 2026"
      onActivate={activate}
      class="h-full"
    />
  </div>
{/snippet}

<Story
  name="Agenda"
  template={agenda}
  play={async ({ canvas, step }) => {
    const region = canvas.getByRole("region", { name: "Coming up" });

    await step("Only the days with something on them are listed, in order", async () => {
      const headings = [
        "Tuesday, September 8, 2026",
        "Friday, September 11, 2026",
        "Saturday, September 12, 2026",
        "Sunday, September 13, 2026",
        DENSE_DAY_HEADING,
      ];
      for (const heading of headings) {
        await expect(canvas.getByText(heading)).toBeVisible();
      }
      await expect(canvas.queryByText("Wednesday, September 9, 2026")).toBeNull();
      await expect(canvas.queryByText("Monday, September 7, 2026")).toBeNull();
    });

    await step("Entries outside the span are not shown", async () => {
      await expect(canvas.queryByRole("button", { name: /Mediation/ })).toBeNull();
      await expect(canvas.queryByText("Wednesday, September 2, 2026")).toBeNull();
    });

    await step("A dense day lists every entry, with the time at the reading edge", async () => {
      const denseDay = canvas.getByText(DENSE_DAY_HEADING).closest("section");
      await expect(denseDay).not.toBeNull();
      await expect(within(denseDay as HTMLElement).getAllByRole("listitem")).toHaveLength(6);
      await expect(within(denseDay as HTMLElement).getAllByRole("listitem")[0]).toHaveTextContent(
        /^9:00 AM\s*Deposition/,
      );
    });

    await step("The agenda is a named region a keyboard can reach and scroll", async () => {
      await expect(region).toHaveAttribute("tabindex", "0");
      await expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
    });
  }}
/>

{#snippet agendaEmpty()}
  <div class="max-w-xl">
    <CalendarGrid.Agenda
      entries={SEPTEMBER}
      label="Coming up"
      from="2026-10-05"
      to="2026-10-18"
      formatDayHeading={pinnedDayHeading}
      emptyMessage="Nothing recorded between October 5 and October 18, 2026"
    />
  </div>
{/snippet}

<Story
  name="AgendaEmpty"
  template={agendaEmpty}
  play={async ({ canvas, step }) => {
    await step("A span with nothing in it says so, and names nothing else", async () => {
      await expect(
        canvas.getByText("Nothing recorded between October 5 and October 18, 2026"),
      ).toBeVisible();
      await expect(canvas.queryByRole("list")).toBeNull();
    });
  }}
/>

{#snippet agendaLoading()}
  <div class="max-w-xl">
    <CalendarGrid.Agenda entries={[]} label="Coming up" loading formatDayHeading={pinnedDayHeading} />
  </div>
{/snippet}

<Story
  name="AgendaLoading"
  template={agendaLoading}
  play={async ({ canvas, step }) => {
    await step("The region reports itself busy and says it is loading", async () => {
      await expect(canvas.getByRole("region", { name: "Coming up" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(canvas.getByText("Loading the calendar")).toBeInTheDocument();
    });
  }}
/>

<!--
  The Day. The one presentation with a time axis: an hour per row, a CALENDAR per column, which is
  the shape a firm needs on a Tuesday its six attorneys spend in four places. The fixture is the
  same domain-free entry shape as every story above, with two facts added — the minute a thing
  starts at, and the colour of the calendar it came from.
-->
{#snippet dayLanes()}
  <div class="max-w-4xl">
    <CalendarGrid.Day
      entries={DAY_ENTRIES}
      lanes={DAY_LANES}
      label="The firm's calendar"
      date="2026-09-15"
      today="2026-09-15"
      locale="en-US"
      onActivate={activate}
    />
  </div>
{/snippet}

<Story
  name="DayLanes"
  template={dayLanes}
  play={async ({ canvas, step }) => {
    const grid = canvas.getByRole("table", { name: "The firm's calendar" });
    const rows = within(grid);

    await step("A column per calendar, named, after the time gutter", async () => {
      const heads = rows.getAllByRole("columnheader");
      await expect(heads).toHaveLength(4);
      await expect(heads[0]).toHaveTextContent("Time");
      await expect(heads[1]).toHaveTextContent("Ada Lovelace");
      await expect(heads[3]).toHaveTextContent("Boardroom");
    });

    await step("What has no hour is in the band above the hours, not parked at midnight", async () => {
      const band = rows.getByRole("rowheader", { name: "All day" }).closest("tr");
      await expect(within(band as HTMLElement).getByText("Response due")).toBeVisible();
    });

    await step("A timed entry sits in the row of the hour it starts in", async () => {
      const nine = rows.getByRole("rowheader", { name: "9 AM" }).closest("tr");
      // One deposition, held in two calendars at once: Ada's, and the boardroom it is booked in.
      const depositions = within(nine as HTMLElement).getAllByText("Deposition");
      await expect(depositions).toHaveLength(2);
      for (const deposition of depositions) await expect(deposition).toBeVisible();
      const two = rows.getByRole("rowheader", { name: "2 PM" }).closest("tr");
      await expect(within(two as HTMLElement).getByText("Settlement conference")).toBeVisible();
    });

    await step("The day widens for an hour outside the working day rather than dropping it", async () => {
      await expect(rows.getByRole("rowheader", { name: "6 AM" })).toBeVisible();
    });

    await step("A chip is a control, and activating it reports the entry it painted", async () => {
      await userEvent.click(rows.getAllByText("Deposition")[0] as HTMLElement);
      await expect(activate).toHaveBeenCalled();
    });
  }}
/>

<!-- One unnamed column: the plain day view, which is what a panel showing one day's schedule is. -->
{#snippet daySingle()}
  <div class="max-w-xl">
    <CalendarGrid.Day
      entries={DAY_ENTRIES}
      label="That day"
      date="2026-09-15"
      locale="en-US"
    />
  </div>
{/snippet}

<Story
  name="DaySingleColumn"
  template={daySingle}
  play={async ({ canvas, step }) => {
    await step("No lanes means one column, and no column heading to read", async () => {
      const grid = canvas.getByRole("table", { name: "That day" });
      await expect(within(grid).getAllByRole("columnheader")).toHaveLength(2);
      await expect(within(grid).queryByText("Ada Lovelace")).toBeNull();
    });
  }}
/>

{#snippet dayLoading()}
  <div class="max-w-4xl">
    <CalendarGrid.Day
      entries={[]}
      lanes={DAY_LANES}
      label="The firm's calendar"
      date="2026-09-15"
      loading
      locale="en-US"
    />
  </div>
{/snippet}

<Story
  name="DayLoading"
  template={dayLoading}
  play={async ({ canvas, step }) => {
    await step("The grid holds its shape and reports itself busy", async () => {
      const grid = canvas.getByRole("table", { name: "The firm's calendar" });
      await expect(grid).toHaveAttribute("aria-busy", "true");
      await expect(within(grid).getAllByRole("columnheader")).toHaveLength(4);
    });
  }}
/>

<!--
  What runs at the same time, both ways. The same crowded morning in one column: divided between
  its settings, and stacked over. Which one a reader sees is theirs to choose (owner ruling,
  2026-09-14) — side by side hides nothing, overlapping keeps each block wide — so the grid offers
  both and decides neither.
-->
{#snippet dayConcurrent()}
  <div class="flex max-w-5xl gap-24">
    <CalendarGrid.Day
      entries={CROWDED_MORNING}
      label="Side by side"
      date="2026-09-15"
      locale="en-US"
      concurrency="side-by-side"
      onActivate={activate}
    />
    <CalendarGrid.Day
      entries={CROWDED_MORNING}
      label="Overlapping"
      date="2026-09-15"
      locale="en-US"
      concurrency="overlap"
      onActivate={activate}
    />
  </div>
{/snippet}

<Story
  name="DayConcurrentEntries"
  template={dayConcurrent}
  play={async ({ canvas, step }) => {
    await step("Both grids hold every setting; neither drops one to fit", async () => {
      await expect(canvas.getAllByRole("button", { name: /Deposition/ })).toHaveLength(2);
      await expect(canvas.getAllByRole("button", { name: /Status conference/ })).toHaveLength(2);
    });

    await step("Side by side divides the column; overlapping does not", async () => {
      const divided = within(canvas.getByRole("table", { name: "Side by side" }));
      const stacked = within(canvas.getByRole("table", { name: "Overlapping" }));
      // Three things at once: a third of the column each when divided, and the first of them still
      // the full width when they are stacked instead.
      const dividedFirst = divided.getAllByRole("listitem")[0];
      const stackedFirst = stacked.getAllByRole("listitem")[0];
      await expect(dividedFirst).toHaveAttribute("style", expect.stringContaining("inline-size: 33"));
      await expect(stackedFirst).toHaveAttribute("style", expect.stringContaining("inline-size: 100%"));
    });
  }}
/>

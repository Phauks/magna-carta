<script lang="ts">
  /*
   * The calendar's one action row, over the grid it moves.
   *
   * TWO ENDS (owner, 2026-11-09). At the reading edge, WHERE: the arrows, then the window's name as
   * the heading over the grid. At the far end, HOW: Today, then the one View menu. Nothing above the
   * grid that is not the grid is anywhere else.
   *
   * THE WINDOW'S NAME IS THE HEADING, AND IT IS A CONTROL. "November 2026" reads as the title of the
   * month beneath it rather than as a label squeezed between two arrows, and pressing it opens
   * MonthJump — twelve months a year at a time — which is how a reader goes somewhere far. The
   * arrows come FIRST, so they stand in the same place whatever length the name is: "May 2026" and
   * "September 2026" would otherwise move the button somebody was about to press again.
   *
   * ONE VIEW MENU, NOT FOUR BUTTONS. Month, week, day and agenda were four icon buttons, and how
   * concurrent entries are drawn was two more beside them on the week and the day. They are one
   * labelled menu now (owner, 2026-11-09), which names the view the reader is in; the concurrency
   * choice and the agenda's Hide settled are sections of it, drawn only on the views where they mean
   * something — a month cell and an agenda are lists, and a list has no concurrency to present.
   *
   * THERE IS NO KINDS FILTER ANY MORE, AND WHICH CALENDARS ARE ON NEVER WAS. The rail beside the
   * grid (calendar-rail.svelte) lists the firm's Case Settings, Deadlines and Firm Events as three
   * calendars of their own, beside the Dates folder, so turning a kind off is turning its calendar
   * off. The separate Kinds menu answered the same question a second way and was removed when the
   * firm's records were split (owner, 2026-11-09).
   */
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Popover from "@magna-carta/design-system/popover";
  import { MonthJump } from "@magna-carta/design-system/calendar";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import CalendarRange from "@lucide/svelte/icons/calendar-range";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import List from "@lucide/svelte/icons/list";
  import type { CalendarGridConcurrency } from "@magna-carta/design-system/calendar-grid";
  import type { CalendarController } from "./calendar-controller.svelte.ts";
  import { CALENDAR_VIEWS, type CalendarView as CalendarViewKind } from "./calendar-window.ts";

  let {
    controller,
    viewSwitch = true,
  }: {
    controller: CalendarController;
    /** Whether the View menu is drawn; a host with its own switch passes false and keeps the rest. */
    viewSwitch?: boolean;
  } = $props();

  /**
   * The two presentations of things that run at the same time, and the word for each. Side by side
   * divides the column, so nothing hides; overlapping steps them over one another, so each block
   * keeps more of its width. Named for what the reader sees, not for the arithmetic behind it.
   */
  const CONCURRENCY_CHOICES: ReadonlyArray<{ value: CalendarGridConcurrency; label: string }> = [
    { value: "side-by-side", label: "Side by side" },
    { value: "overlap", label: "Overlapping" },
  ];

  /** The views with an hour axis, which are the only ones concurrency is a question on. */
  const timeGrid = $derived(controller.view === "week" || controller.view === "day");

  const VIEW_PRESENTATION: Record<CalendarViewKind, { label: string; icon: typeof List }> = {
    month: { label: "Month", icon: CalendarDays },
    week: { label: "Week", icon: CalendarRange },
    // The day is columns: it is the one view whose shape IS a column per calendar.
    day: { label: "Day", icon: Columns3 },
    agenda: { label: "Agenda", icon: List },
  };

  const current = $derived(VIEW_PRESENTATION[controller.view]);

  /** What one step of the navigation moves by, so the arrows say where they go. */
  const STEP_NAMES: Record<CalendarViewKind, string> = {
    month: "month",
    week: "week",
    day: "day",
    agenda: "fortnight",
  };

  /** A civil date's year and month, as MonthJump speaks them. */
  function yearMonthOf(civilDate: string): { year: number; month: number } {
    return { year: Number(civilDate.slice(0, 4)), month: Number(civilDate.slice(5, 7)) };
  }

  let jumpOpen = $state(false);

  /** A month chosen from the jump: its first day, in whatever view the reader is in. */
  function jumpTo(chosen: { year: number; month: number }): void {
    controller.goToDay(`${String(chosen.year).padStart(4, "0")}-${String(chosen.month).padStart(2, "0")}-01`);
    jumpOpen = false;
  }

  function isView(value: string): value is CalendarViewKind {
    return (CALENDAR_VIEWS as readonly string[]).includes(value);
  }

  function isConcurrency(value: string): value is CalendarGridConcurrency {
    return CONCURRENCY_CHOICES.some((choice) => choice.value === value);
  }
</script>

<div class="flex flex-wrap items-center gap-8">
  <!-- WHERE: the arrows, then the window's name as the heading over the grid. -->
  <div class="flex min-w-0 flex-1 items-center gap-4" role="group" aria-label="Move through time">
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Previous {STEP_NAMES[controller.view]}"
      title="Previous {STEP_NAMES[controller.view]}"
      onclick={() => controller.navigate(-1)}
    >
      <ChevronLeft class="size-16" aria-hidden="true" />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Next {STEP_NAMES[controller.view]}"
      title="Next {STEP_NAMES[controller.view]}"
      onclick={() => controller.navigate(1)}
    >
      <ChevronRight class="size-16" aria-hidden="true" />
    </Button>
    <Popover.Root bind:open={jumpOpen}>
      <!-- The ghost button's own recipe on the trigger, at the heading's size: the name is read
           first and pressed second, so it wears the heading's type and only the hover says it is a
           control. It truncates rather than wrapping, with the full name on its title. -->
      <Popover.Trigger
        class="{buttonClasses({ variant: 'ghost', size: 'default' })} min-w-0 text-xl font-semibold"
        title="Choose a month: {controller.title}"
        aria-label="{controller.title}, choose a month"
      >
        <span class="min-w-0 truncate" aria-live="polite">{controller.title}</span>
        <ChevronDown class="size-16 shrink-0 text-text-subtle" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Content align="start" class="w-auto">
        <MonthJump
          value={yearMonthOf(controller.anchor)}
          today={yearMonthOf(controller.today)}
          onchoose={jumpTo}
        />
      </Popover.Content>
    </Popover.Root>
  </div>

  <!-- HOW: back to today, then the one View menu. -->
  <div class="flex items-center gap-8">
    <Button variant="secondary" size="sm" onclick={() => controller.goToday()}>Today</Button>

    {#if viewSwitch}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={buttonClasses({ variant: "secondary", size: "sm" })}
          aria-label="View: {current.label}"
        >
          <current.icon class="size-16" aria-hidden="true" />
          {current.label}
          <ChevronDown class="size-16" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Group>
            <DropdownMenu.GroupHeading>View</DropdownMenu.GroupHeading>
            <DropdownMenu.RadioGroup
              value={controller.view}
              onValueChange={(next) => {
                if (isView(next)) controller.setView(next);
              }}
            >
              {#each CALENDAR_VIEWS as view (view)}
                <DropdownMenu.RadioItem value={view} closeOnSelect={true}>
                  {VIEW_PRESENTATION[view].label}
                </DropdownMenu.RadioItem>
              {/each}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Group>

          {#if timeGrid}
            <!-- Only where there is an hour axis to be concurrent ON. -->
            <DropdownMenu.Separator />
            <DropdownMenu.Group>
              <DropdownMenu.GroupHeading>Things at the same time</DropdownMenu.GroupHeading>
              <DropdownMenu.RadioGroup
                value={controller.concurrency}
                onValueChange={(next) => {
                  if (isConcurrency(next)) controller.chooseConcurrency(next);
                }}
              >
                {#each CONCURRENCY_CHOICES as choice (choice.value)}
                  <DropdownMenu.RadioItem value={choice.value}>{choice.label}</DropdownMenu.RadioItem>
                {/each}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Group>
          {/if}

          {#if controller.view === "agenda"}
            <DropdownMenu.Separator />
            <DropdownMenu.CheckboxItem
              checked={controller.hideSettled}
              onCheckedChange={() => controller.toggleHideSettled()}
            >
              Hide settled
            </DropdownMenu.CheckboxItem>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>
</div>

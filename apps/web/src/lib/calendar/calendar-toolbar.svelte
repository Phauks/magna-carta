<script lang="ts">
  /*
   * The calendar's one action row, at the reading edge.
   *
   * Three groups, left to right: what is painted (on the agenda, whether settled entries are hidden;
   * on a time grid, how things that run at the same time are drawn), which view (month, week, day,
   * agenda, as icon buttons held pressed), and where in time (previous, the window's name, next, and
   * Today). Nothing above the grid that is not the grid is anywhere else.
   *
   * HOW CONCURRENT ENTRIES ARE DRAWN IS OFFERED WHERE IT MEANS SOMETHING, which is the week and the
   * day: those are the two views with an hour axis, where two things at ten o'clock either divide
   * their column or lie over one another. A month cell and an agenda are lists — a list has no
   * concurrency to present — so the control is not drawn there rather than drawn inert.
   *
   * WHOSE CALENDAR IS NOT IN THIS ROW, AND WHICH CALENDARS ARE ON NEVER WAS. Both are the rail
   * beside the grid (calendar-rail.svelte), which lists a calendar per attorney, per room and per
   * kind of date and switches each on its own. The row carried a Mine / Everyone pair and a
   * colleague dropdown beside them until 2026-09-14, when the owner removed all three as covered by
   * the rail: a reader wanting their own day turns their own calendar on, and a pair of buttons
   * narrowing the SAME firm read was a second mechanism answering a question the rail answers
   * better. The address's `scope=` key is still read, so a link somebody was handed still opens
   * where it says.
   *
   * THE WINDOW'S NAME NEVER MOVES THE CONTROLS BESIDE IT. "September 2026" and "Sep 28 – Oct 11,
   * 2026" are different lengths, and a name that reflowed the row would move the very button the
   * reader was about to press again. So the slot's width is decided by the ROW rather than by the
   * text: it takes the slack the other groups leave, up to the reading measure it had before, and
   * truncates with the full name on its title. On a laptop that slack is small and the row still
   * holds one line; on a monitor the slot opens to its cap and the groups sit where they always did.
   * A fixed length would have meant a second row at every laptop width, which is what the owner met
   * on 2026-09-17 ("calendar is very tight on my laptop, and has multiple scrollbars").
   *
   * THE ROW HOLDS ONE LINE, AND EVERY GROUP EARNS ITS WIDTH. Show Everything is the Kinds menu's
   * own last item rather than a button beside it, so narrowing the calendar cannot make the row
   * taller; the view switch and the arrows are the small square control, which is the height the
   * rest of the row already stands at. Wrapping survives as the fallback below the width the groups
   * themselves need, and nothing moved into the screen's header — the header is the screen's name
   * and its actions, and these controls move the grid they stand over.
   *
   * A toggle's active side is unmistakable by fill (the standing ruling): the pressed half wears
   * the secondary register and the other half the ghost one, the same pattern as the view switch
   * in $lib/view-shell/view-switch.svelte.
   */
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import ListFilter from "@lucide/svelte/icons/list-filter";
  import { SCHEDULE_KINDS } from "./schedule-narrowing.ts";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import CalendarRange from "@lucide/svelte/icons/calendar-range";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import List from "@lucide/svelte/icons/list";
  import type { CalendarGridConcurrency } from "@magna-carta/design-system/calendar-grid";
  import type { CalendarController } from "./calendar-controller.svelte.ts";
  import { CALENDAR_VIEWS, type CalendarView as CalendarViewKind } from "./calendar-window.ts";

  let {
    controller,
    viewSwitch = true,
  }: {
    controller: CalendarController;
    /** Whether the month / week / agenda switch is drawn; a host with its own switch passes false. */
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

  /** What one step of the navigation moves by, so the arrows say where they go. */
  const STEP_NAMES: Record<CalendarViewKind, string> = {
    month: "month",
    week: "week",
    day: "day",
    agenda: "fortnight",
  };
</script>

<div class="flex flex-wrap items-center gap-8">
  <!--
    WHAT KIND, which is the other half of the question the rail answers. The rail says whose
    calendar; this says what sort of thing, and a firm's week holds hearings, deadlines, staff
    meetings and reservations that a reader is almost always reading it for one of (owner,
    2026-09-16). It narrows what was already read and makes no request — so it reaches exactly as
    far as the window on screen, which is why it sits beside the window's own navigation rather
    than beside a search that would imply the whole record.
  -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class={buttonClasses({ variant: controller.narrowed ? "secondary" : "ghost", size: "sm" })}
      aria-label="Narrow what is shown"
      title="Narrow what is shown to the kinds that matter"
    >
      <ListFilter class="size-16" aria-hidden="true" />
      Kinds
    </DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading>Show</DropdownMenu.GroupHeading>
        {#each SCHEDULE_KINDS as choice (choice.kind)}
          <DropdownMenu.CheckboxItem
            checked={!controller.narrowed || controller.narrowedKinds.has(choice.kind)}
            onCheckedChange={() => controller.toggleKind(choice.kind)}
          >
            {choice.label}
          </DropdownMenu.CheckboxItem>
        {/each}
      </DropdownMenu.Group>
      <!-- THE WAY BACK TO EVERYTHING IS THE MENU'S OWN LAST ITEM, not a button beside the trigger.
           It undoes what this menu did, so this is where somebody looks for it — and a control that
           appeared beside the trigger the moment a kind came off made the row wider exactly when a
           reader had narrowed it, which on a laptop is what put the row onto a second line. The
           standing rule still holds: it renders nothing while there is nothing to undo, because a
           disabled Clear reads as broken. The trigger keeps saying that something IS narrowed by
           wearing the secondary register. -->
      {#if controller.narrowed}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => controller.clearNarrowing()}>
          Show Everything
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  {#if controller.view === "agenda"}
    <div class="flex items-center gap-4" role="group" aria-label="What is shown">
      <Button
        variant={controller.hideSettled ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={controller.hideSettled}
        onclick={() => controller.toggleHideSettled()}
      >
        Hide settled
      </Button>
    </div>
  {/if}

  {#if timeGrid}
    <!-- Only where there is an hour axis to be concurrent ON. The pressed half wears the secondary
         register and the other the ghost one, as every toggle on this row does. -->
    <div class="flex items-center gap-4" role="group" aria-label="Things at the same time">
      {#each CONCURRENCY_CHOICES as choice (choice.value)}
        {@const pressed = controller.concurrency === choice.value}
        <Button
          variant={pressed ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={pressed}
          onclick={() => controller.chooseConcurrency(choice.value)}
        >
          {choice.label}
        </Button>
      {/each}
    </div>
  {/if}

  {#if viewSwitch}
  <!-- The square glyph control at the SMALL height, which is the height every other control on
       this row stands at: the larger square added four points to the row and bought nothing. -->
  <div class="flex items-center gap-4" role="group" aria-label="View">
    {#each CALENDAR_VIEWS as view (view)}
      {@const presentation = VIEW_PRESENTATION[view]}
      {@const Icon = presentation.icon}
      <Button
        variant={controller.view === view ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label={presentation.label}
        title={presentation.label}
        aria-pressed={controller.view === view}
        onclick={() => controller.setView(view)}
      >
        <Icon class="size-16" aria-hidden="true" />
      </Button>
    {/each}
  </div>
  {/if}

  <!-- The window's navigation takes whatever width the groups before it left, which is what the
       name's own slot is measured out of. The group itself still packs to the reading edge: the
       name stops at its cap and the slack comes to rest after Today. -->
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
    <!-- The slot the ROW decides the width of, never the name: it grows with the space the row has
         and stops at the measure it always had, so the arrow on its far side stays put as the
         window moves and the whole row stays on one line at a laptop's width. -->
    <p
      class="min-w-0 max-w-3xs flex-1 truncate text-center text-sm font-medium text-text-default"
      title={controller.title}
      aria-live="polite"
    >
      {controller.title}
    </p>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Next {STEP_NAMES[controller.view]}"
      title="Next {STEP_NAMES[controller.view]}"
      onclick={() => controller.navigate(1)}
    >
      <ChevronRight class="size-16" aria-hidden="true" />
    </Button>
    <Button variant="secondary" size="sm" onclick={() => controller.goToday()}>Today</Button>
  </div>
</div>

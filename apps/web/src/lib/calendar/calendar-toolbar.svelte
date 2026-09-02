<script lang="ts">
  /*
   * The calendar's one action row, at the reading edge.
   *
   * Three groups, left to right: whose calendar (Mine or Everyone, on the firm side only), which
   * view (month, week, agenda, as icon buttons held pressed), and where in time (previous, the
   * window's name, next, and Today). Nothing above the grid that is not the grid is anywhere else.
   *
   * THE WINDOW'S NAME SITS IN A FIXED-WIDTH SLOT. "September 2026" and "Sep 28 – Oct 11, 2026" are
   * different lengths, and a name that reflowed the controls beside it would move the very button
   * the reader was about to press again. The slot truncates instead, with the full name on its
   * title. The Today control is always drawn: today is a destination, not an undo.
   *
   * A toggle's active side is unmistakable by fill (the standing ruling): the pressed half wears
   * the secondary register and the other half the ghost one, the same pattern as the view switch
   * in $lib/view-shell/view-switch.svelte.
   */
  import Button from "@magna-carta/design-system/button";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import CalendarRange from "@lucide/svelte/icons/calendar-range";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import List from "@lucide/svelte/icons/list";
  import type { CalendarController, ScopeChoice } from "./calendar-controller.svelte.ts";
  import { CALENDAR_VIEWS, type CalendarView as CalendarViewKind } from "./calendar-window.ts";

  let {
    controller,
    viewSwitch = true,
  }: {
    controller: CalendarController;
    /** Whether the month / week / agenda switch is drawn; a host with its own switch passes false. */
    viewSwitch?: boolean;
  } = $props();

  const VIEW_PRESENTATION: Record<CalendarViewKind, { label: string; icon: typeof List }> = {
    month: { label: "Month", icon: CalendarDays },
    week: { label: "Week", icon: CalendarRange },
    agenda: { label: "Agenda", icon: List },
  };

  const SCOPE_CHOICES: ReadonlyArray<{ value: ScopeChoice; label: string }> = [
    { value: "mine", label: "Mine" },
    { value: "everyone", label: "Everyone" },
  ];

  /** What one step of the navigation moves by, so the arrows say where they go. */
  const STEP_NAMES: Record<CalendarViewKind, string> = {
    month: "month",
    week: "week",
    agenda: "fortnight",
  };
</script>

<div class="flex flex-wrap items-center gap-16">
  {#if controller.firmSide}
    <div class="flex items-center gap-4" role="group" aria-label="Whose calendar">
      {#each SCOPE_CHOICES as choice (choice.value)}
        {@const pressed = controller.scopeChoice === choice.value}
        {@const refusal = choice.value === "mine" ? controller.mineRefusal : undefined}
        <Button
          variant={pressed ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={pressed}
          disabled={refusal !== undefined}
          title={refusal}
          onclick={() => controller.chooseScope(choice.value)}
        >
          {choice.label}
        </Button>
      {/each}
    </div>
  {/if}

  {#if viewSwitch}
  <div class="flex items-center gap-4" role="group" aria-label="View">
    {#each CALENDAR_VIEWS as view (view)}
      {@const presentation = VIEW_PRESENTATION[view]}
      {@const Icon = presentation.icon}
      <Button
        variant={controller.view === view ? "secondary" : "ghost"}
        size="icon"
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

  <div class="flex items-center gap-4" role="group" aria-label="Move through time">
    <Button
      variant="ghost"
      size="icon"
      aria-label="Previous {STEP_NAMES[controller.view]}"
      title="Previous {STEP_NAMES[controller.view]}"
      onclick={() => controller.navigate(-1)}
    >
      <ChevronLeft class="size-16" aria-hidden="true" />
    </Button>
    <!-- A fixed slot, so the arrow on its far side never moves as the name changes length. -->
    <p class="w-3xs truncate text-center text-sm font-medium text-text-default" title={controller.title} aria-live="polite">
      {controller.title}
    </p>
    <Button
      variant="ghost"
      size="icon"
      aria-label="Next {STEP_NAMES[controller.view]}"
      title="Next {STEP_NAMES[controller.view]}"
      onclick={() => controller.navigate(1)}
    >
      <ChevronRight class="size-16" aria-hidden="true" />
    </Button>
    <Button variant="secondary" size="sm" onclick={() => controller.goToday()}>Today</Button>
  </div>
</div>

<script lang="ts">
  /*
   * WHICH CALENDARS ARE SHOWN, as a menu: the rail's folders and rows, for a calendar that has no
   * room for a rail.
   *
   * The day being booked stands beside the record form (day-schedule.svelte), and a person choosing
   * a time there is asking who is busy — which is a question about PARTICULAR calendars: this
   * attorney's, that room's. The pane painted whatever the reader last had on in the rail and
   * offered no way to change it without closing the form (owner, 2026-09-18: "on the right side,
   * need to be able to toggle on the various calendars so users can check for availability").
   *
   * IT IS THE RAIL'S SELECTION, NOT A SECOND ONE. Which calendars are on is personal and held per
   * browser (calendar-preferences.svelte.ts), and a menu that kept a private selection would have
   * two answers to "what am I looking at" — the pane's and the screen's — that could disagree. So
   * the menu reads and writes the same selection through the same controller, and a calendar
   * turned on here is on in the rail when the form closes. A folder is a group heading with a
   * checkbox per calendar; a calendar marked Soon is not offered, because a menu row cannot carry
   * the affordance the rail gives it, and a row that could be ticked and paint nothing is worse
   * than a row that is absent.
   */
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import type { CalendarController } from "./calendar-controller.svelte.ts";

  let {
    controller,
  }: {
    controller: CalendarController;
  } = $props();

  const onCount = $derived(controller.selectedSources.length);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={buttonClasses({ variant: "ghost", size: "sm" })}
    aria-label="Choose which calendars are shown"
    title="Choose which calendars are shown"
  >
    <CalendarDays class="size-16" aria-hidden="true" />
    Calendars
    <span class="text-xs text-text-muted">{onCount}</span>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content>
    {#each controller.folders as folder (folder.key)}
      {@const offered = folder.sources.filter((source) => source.soonReason === undefined)}
      {#if offered.length > 0}
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading>{folder.name}</DropdownMenu.GroupHeading>
          {#each offered as source (source.key)}
            <DropdownMenu.CheckboxItem
              checked={controller.onKeys.has(source.key)}
              onCheckedChange={() => controller.toggleCalendar(source)}
            >
              {source.name}
            </DropdownMenu.CheckboxItem>
          {/each}
        </DropdownMenu.Group>
      {/if}
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>

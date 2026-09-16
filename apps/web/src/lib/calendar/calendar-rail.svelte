<script lang="ts">
  /*
   * The rail of calendars: every individual calendar the firm has, in folders, each with its own
   * switch and its own colour.
   *
   * The firm calendar used to be one grid over everything, with one dropdown that offered one
   * colleague at a time. A firm does not work that way — it has a calendar per attorney, a calendar
   * per paralegal and receptionist, a calendar per conference room, and a few that are dates rather
   * than people — so this is the rail every calendar product settled on, over the catalog in
   * calendar-sources.ts.
   *
   * IT DRAWS NO COLUMN OF ITS OWN. The rail stands in the navigation column of the design system's
   * NavigationLayout, which owns the landmark and its name, the measure, the scroll region and the
   * reserved gutter — so this file is the column's CONTENT and nothing else, and the firm calendar
   * cannot drift from Settings, Magnus, Tools or Reports in what a permanent left column looks
   * like. It had its own `<nav>` at `w-3xs` with its own scrollbar until 2026-09-14, which was the
   * fifth hand-rolled copy of a shape the owner ruled is one component.
   *
   * THE FOLDER HEADS ITS GROUP, and there is no title above the folders: the column is named by the
   * landmark, exactly as the catalogue column's is, and a "Calendars" heading over a column of
   * Attorneys / Staff / Rooms / Dates would be a level neither sibling screen has. The indent
   * stagger is the family's — the folder's cap-line at 12, its calendars one step past it — so a
   * reader who has learned one two-sided screen has learned this one.
   *
   * A FOLDER'S OWN CONTROL IS A THIRD STATE, NOT A SECOND BUTTON. Two of six attorneys on is neither
   * on nor off, and the checkbox says so; pressing it from there completes the folder, which is what
   * somebody who turned two on and reached for the folder meant.
   *
   * A CALENDAR'S ROW IS A CHECKBOX ROW, NOT NavigationLayout.Row. The shared row is a destination or
   * an act — it renders the anchor or the button itself and lights the one the reader is standing on
   * — and every row here is a switch with a control already inside it, which cannot be nested in
   * another. What the two share is the column and the stagger; the part that differs is the part
   * that genuinely differs, which is why the layout imposes no structure on what a navigation holds.
   *
   * THE COLOUR IS BEHIND THE PIP, where the colour already is. A row shows the colour it wears as a
   * small disc; pressing the disc opens the palette. A separate control per row would be a second
   * thing on every line of a rail that is mostly names, and the disc is the one part of the row that
   * is already about colour.
   *
   * A CALENDAR WITH NOTHING BEHIND IT YET IS STILL LISTED, marked Soon and refused — the standing
   * rule for a designed-but-unwired capability. A firm asking whether this product holds its
   * file-destruction dates can see the answer, and can never mistake the shape of it for the thing.
   */
  import { buttonClasses } from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import * as Popover from "@magna-carta/design-system/popover";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import { PaletteSwatches } from "@magna-carta/design-system/palette";
  import { CALENDAR_COLORS } from "@magna-carta/design-system/calendar-grid";
  import type { CalendarController } from "./calendar-controller.svelte.ts";
  import type { CalendarFolder, CalendarSource } from "./calendar-sources.ts";

  let {
    controller,
  }: {
    controller: CalendarController;
  } = $props();

  const idPrefix = $props.id();

  /** How a colour control names what it would colour. */
  function colorLabel(source: CalendarSource): string {
    return `Colour of ${source.name}`;
  }

  function folderIndeterminate(folder: CalendarFolder): boolean {
    return controller.folderState(folder) === "some";
  }

  function folderChecked(folder: CalendarFolder): boolean {
    return controller.folderState(folder) === "all";
  }
</script>

<div class="flex flex-col gap-24">
  {#each controller.folders as folder (folder.key)}
    <div class="flex flex-col gap-8">
      <!-- The folder heads its group at the column's cap-line of 12, where the catalogue column's
           section header and the settings nav's band header both sit. Its own switch reads the
           three states its calendars can be in, and completing it is what pressing the middle one
           does. -->
      <div class="flex items-center gap-8 px-12">
        <Checkbox
          id="{idPrefix}-{folder.key}"
          checked={folderChecked(folder)}
          indeterminate={folderIndeterminate(folder)}
          onCheckedChange={() => controller.toggleCalendarFolder(folder)}
        />
        <!-- A folder heads a group of calendars, so it wears the product's small-caps register
             rather than a field's own label voice — and it still points at its checkbox. -->
        <Label for="{idPrefix}-{folder.key}" class="mc-field-label">{folder.name}</Label>
      </div>

      <!-- One stagger step past the folder: the list's own inset plus each row's, which is how the
           catalogue column lands its rows 12 past its section header. -->
      <ul class="flex flex-col gap-4 ps-12">
        {#each folder.sources as source (source.key)}
          {@const on = controller.onKeys.has(source.key)}
          {@const color = controller.colors.get(source.key)}
          <li class="flex min-w-0 items-center gap-8 px-12">
            {#if source.soonReason === undefined}
              <Checkbox
                id="{idPrefix}-{source.key}"
                checked={on}
                onCheckedChange={() => controller.toggleCalendar(source)}
              />
              <Label for="{idPrefix}-{source.key}" class="min-w-0 flex-1 text-sm font-normal">
                {source.name}
              </Label>
              <!-- The colour lives behind the disc that already shows it. The disc is eight
                   pixels and a pointer target is not, so the CONTROL is the ghost icon button
                   every quiet chrome affordance in the product is, with the disc inside it. -->
              <Popover.Root>
                <!-- The button's own recipe on the trigger, which renders the element itself: the
                     ghost icon register every quiet chrome affordance wears. -->
                <Popover.Trigger
                  class={buttonClasses({ variant: "ghost", size: "icon" })}
                  aria-label={colorLabel(source)}
                  title={colorLabel(source)}
                >
                  <span class="mc-palette-pip" data-palette-color={color} aria-hidden="true"></span>
                </Popover.Trigger>
                <Popover.Content class="w-auto">
                  <PaletteSwatches
                    colors={CALENDAR_COLORS}
                    value={color}
                    label={colorLabel(source)}
                    onchoose={(chosen) => controller.chooseColor(source.key, chosen)}
                  />
                </Popover.Content>
              </Popover.Root>
            {:else}
              <SoonAffordance reason={source.soonReason}>
                {#snippet control(soon)}
                  <span class="flex min-w-0 items-center gap-8">
                    <Checkbox checked={false} {...soon} />
                    <span class="min-w-0 flex-1 text-sm text-text-muted">{source.name}</span>
                  </span>
                {/snippet}
              </SoonAffordance>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</div>

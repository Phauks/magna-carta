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
   * A FOLDER FOLDS, AND FOLDING COSTS NO CAPABILITY. A firm with twenty rooms scrolled past all
   * twenty to reach the folder under them (owner, 2026-09-16). The disclosure is the folder's NAME —
   * chevron and name are one button, at the full width of what is left after the checkbox, which is
   * the shape the application sidebar's own groups take. It is not the Accordion component: that
   * component's trigger IS its whole header, and this header already holds a checkbox, which cannot
   * be nested inside a button. What folds here is the LIST, not the head — so the three-state
   * control stays reachable whether the folder is open or shut, and folding hides no calendar a
   * reader could otherwise turn on. Hiding must never remove capability, which is the rule the
   * sidebar's own fold keeps.
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
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
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

  /** How the folder's own switch names itself, now that the name beside it is the disclosure. */
  function folderSwitchLabel(folder: CalendarFolder): string {
    return `Every calendar in ${folder.name}`;
  }

  /**
   * How many of a folder's calendars are on, shown only while it is SHUT.
   *
   * A folded folder hides its rows, and with them the only evidence that three of its rooms are
   * painting on the grid. The count is that evidence, and it is absent while the folder is open
   * because the rows themselves say it better.
   */
  function folderOnCount(folder: CalendarFolder): number {
    return folder.sources.filter((source) => controller.onKeys.has(source.key)).length;
  }
</script>

<div class="flex flex-col gap-24">
  {#each controller.folders as folder (folder.key)}
    {@const folded = controller.foldedFolders.has(folder.key)}
    <div class="flex flex-col gap-8">
      <!-- The folder heads its group at the column's cap-line of 12, where the catalogue column's
           section header and the settings nav's band header both sit. Its own switch reads the
           three states its calendars can be in, and completing it is what pressing the middle one
           does. -->
      <div class="flex items-center gap-8 px-12">
        <!-- The switch names itself now, because the name beside it belongs to the disclosure: a
             label pointing at the checkbox and a button carrying the same words would be two
             controls answering to one name. -->
        <Checkbox
          checked={folderChecked(folder)}
          indeterminate={folderIndeterminate(folder)}
          aria-label={folderSwitchLabel(folder)}
          onCheckedChange={() => controller.toggleCalendarFolder(folder)}
        />
        <!-- The name IS the disclosure, at the full width of what is left, so the target is the
             heading rather than a chevron somebody has to hit. A folder heads a group of calendars,
             so it keeps the product's small-caps register. -->
        <button
          type="button"
          class="mc-field-label group flex min-w-0 flex-1 items-center gap-4 text-start"
          aria-expanded={!folded}
          aria-controls="{idPrefix}-{folder.key}-calendars"
          onclick={() => controller.toggleCalendarFolderFold(folder)}
        >
          <ChevronRight
            class="size-12 shrink-0 transition-transform group-aria-expanded:rotate-90"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate">{folder.name}</span>
          {#if folded && folderOnCount(folder) > 0}
            <!-- What a shut folder would otherwise hide: that some of it is still painting. -->
            <span class="text-xs font-normal text-text-muted">{folderOnCount(folder)}</span>
          {/if}
        </button>
      </div>

      <!-- One stagger step past the folder: the list's own inset plus each row's, which is how the
           catalogue column lands its rows 12 past its section header. -->
      <ul
        id="{idPrefix}-{folder.key}-calendars"
        class="flex flex-col gap-4 ps-12"
        class:hidden={folded}
      >
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
                   every quiet chrome affordance in the product is, with the disc inside it. It is
                   the SMALL square: the row is a checkbox and a name, and the larger square set the
                   height of every row in a column a firm with twenty rooms already has to scroll. -->
              <Popover.Root>
                <!-- The button's own recipe on the trigger, which renders the element itself: the
                     ghost icon register every quiet chrome affordance wears. -->
                <Popover.Trigger
                  class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
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

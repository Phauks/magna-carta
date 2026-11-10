<script lang="ts">
  /*
   * The chip one entry is presented as, shared by every CalendarGrid part.
   *
   * It is a real control — a link when the entry goes somewhere, a button otherwise — so it sits
   * in DOM order and a keyboard reaches it without the grid needing any ARIA of its own. The time
   * leads, at the reading edge, then the label; the detail is a second line where the host part
   * has room for one (the week and the agenda), and is left off in a month cell, where it would
   * make three entries cost the height of six.
   *
   * A struck entry is shown and struck, never hidden, and a reader who cannot see the line through
   * it is told in words. The tone, the calendar's colour and the span position ride on data
   * attributes the recipe keys off; nothing here chooses a colour.
   *
   * THE TONE AND THE COLOUR ANSWER DIFFERENT QUESTIONS AND NEVER FIGHT. The tone is the product's
   * status register and paints the chip; the colour is the reader's own answer to which of their
   * calendars this came from, and paints a rule down the chip's leading edge. A chip with no
   * colour is exactly the chip this family drew before there were calendars to tell apart.
   */
  import Repeat from "@lucide/svelte/icons/repeat";
  import type { CalendarGridEntry } from "./types.ts";

  let {
    entry,
    layout = "cell",
    showDetail = false,
    span = false,
    spanStart = false,
    spanEnd = false,
    onActivate,
  }: {
    entry: CalendarGridEntry;
    /**
     * `cell` for a grid cell, where the time is shown only when there is one; `row` for an agenda
     * line, where the time's column is always drawn so the labels beneath one another align.
     */
    layout?: "cell" | "row";
    /** Whether the detail line is drawn. */
    showDetail?: boolean;
    /** True when the entry covers more than one day. */
    span?: boolean;
    /** True on the first day of a span. */
    spanStart?: boolean;
    /** True on the last day of a span. */
    spanEnd?: boolean;
    onActivate?: (entry: CalendarGridEntry) => void;
  } = $props();

  /** What a reader who cannot see the line through a struck label is told instead. */
  const STRUCK_LABEL = "struck through";
  /** What a reader who cannot see the repeat glyph is told instead. */
  const REPEATS_LABEL = "repeats";

  /** The whole entry in one line, for the tooltip a truncated month chip needs. */
  const fullText = $derived(
    [entry.time, entry.label, showDetail ? undefined : entry.detail]
      .filter((part) => part !== undefined && part !== "")
      .join(" · "),
  );

  function activate(): void {
    onActivate?.(entry);
  }
</script>

{#snippet content()}
  {#if entry.repeats}
    <Repeat class="mc-calendar-grid-entry-repeat" aria-hidden="true" />
  {/if}
  {#if entry.time !== undefined || layout === "row"}
    <span class="mc-calendar-grid-entry-time">{entry.time ?? "\u00a0"}</span>
  {/if}
  <span class="mc-calendar-grid-entry-body">
    <span class="mc-calendar-grid-entry-label">{entry.label}</span>
    {#if entry.struck}
      <span class="sr-only">{STRUCK_LABEL}</span>
    {/if}
    {#if entry.repeats}
      <span class="sr-only">{REPEATS_LABEL}</span>
    {/if}
    {#if showDetail && entry.detail}
      <span class="mc-calendar-grid-entry-detail">{entry.detail}</span>
    {/if}
  </span>
{/snippet}

{#if entry.href}
  <a
    href={entry.href}
    class="mc-calendar-grid-entry"
    title={layout === "cell" ? fullText : undefined}
    data-tone={entry.tone}
    data-color={entry.color}
    data-struck={entry.struck ? "true" : undefined}
    data-span={span ? "true" : undefined}
    data-span-start={spanStart ? "true" : undefined}
    data-span-end={spanEnd ? "true" : undefined}
    onclick={activate}
  >
    {@render content()}
  </a>
{:else}
  <button
    type="button"
    class="mc-calendar-grid-entry"
    title={layout === "cell" ? fullText : undefined}
    data-tone={entry.tone}
    data-color={entry.color}
    data-struck={entry.struck ? "true" : undefined}
    data-span={span ? "true" : undefined}
    data-span-start={spanStart ? "true" : undefined}
    data-span-end={spanEnd ? "true" : undefined}
    onclick={activate}
  >
    {@render content()}
  </button>
{/if}

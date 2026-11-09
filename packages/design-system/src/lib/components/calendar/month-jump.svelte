<script lang="ts">
  /*
   * MonthJump — twelve months as a grid, a year at a time, with arrows between the years.
   *
   * THE READABLE WAY TO GO SOMEWHERE FAR. A month and a year used to be chosen from two native
   * selects in the calendar's header: a list of twelve words and a list of a hundred years, each
   * scrolled and read one line at a time, which the owner found hard to read and hard to aim at
   * (2026-11-09). Twelve buttons show the whole year at once, the month the reader is on is filled,
   * and the month that is today wears the same hairline ring today wears in the day grid — so the
   * way back is visible without a separate control.
   *
   * It is DOMAIN-FREE and holds no state of its own beyond the year it is showing: the caller says
   * which month is current and hears which one was chosen. It renders no frame either; a caller puts
   * it in a popover (the compact Calendar's heading, the calendar screen's window heading).
   */
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { formatMonthName } from "../../formatters/civil-date.ts";

  /** A month of a year: `month` counts from 1, as a civil date does. */
  interface YearMonth {
    readonly year: number;
    readonly month: number;
  }

  let {
    value,
    today,
    onchoose,
    locale,
    class: className,
  }: {
    /** The month the reader is on; it is filled, and its year is the one shown first. */
    value: YearMonth;
    /** The month that holds today, which wears the today ring. */
    today?: YearMonth;
    /** Called with the month pressed. */
    onchoose: (chosen: YearMonth) => void;
    /** The locale the month names are written in. The viewer's when absent. */
    locale?: string;
    class?: string;
  } = $props();

  const MONTHS_IN_YEAR = 12;

  // The year on show starts at the value's and is the reader's to move from there.
  let shownYear = $state(0);
  $effect.pre(() => {
    shownYear = value.year;
  });

  const monthNames = $derived(
    Array.from({ length: MONTHS_IN_YEAR }, (_, index) => ({
      short: formatMonthName(index + 1, { locale, width: "short" }),
      long: formatMonthName(index + 1, { locale, width: "long" }),
    })),
  );
</script>

<div class={mergeClasses("mc-month-jump", className)}>
  <div class="mc-month-jump-header">
    <button
      type="button"
      class="mc-calendar-nav"
      aria-label="Previous year"
      onclick={() => (shownYear -= 1)}
    >
      <ChevronLeft class="mc-calendar-nav-icon" aria-hidden="true" />
    </button>
    <p class="mc-month-jump-year" aria-live="polite">{shownYear}</p>
    <button
      type="button"
      class="mc-calendar-nav"
      aria-label="Next year"
      onclick={() => (shownYear += 1)}
    >
      <ChevronRight class="mc-calendar-nav-icon" aria-hidden="true" />
    </button>
  </div>
  <div class="mc-month-jump-grid" role="group" aria-label="Months of {shownYear}">
    {#each monthNames as name, index (index)}
      {@const month = index + 1}
      {@const current = value.year === shownYear && value.month === month}
      <button
        type="button"
        class="mc-month-jump-month"
        data-selected={current ? "" : undefined}
        data-today={today !== undefined && today.year === shownYear && today.month === month
          ? ""
          : undefined}
        aria-pressed={current}
        aria-label="{name.long} {shownYear}"
        onclick={() => onchoose({ year: shownYear, month })}
      >
        {name.short}
      </button>
    {/each}
  </div>
</div>
